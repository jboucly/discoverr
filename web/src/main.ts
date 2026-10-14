import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { api, setUnauthorizedHandler } from "./api";
import App from "./App.vue";
import { auth, markAuthenticated } from "./auth";
import "./styles.css";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "week", component: () => import("./views/WeekView.vue") },
    { path: "/historique", name: "history", component: () => import("./views/HistoryView.vue") },
    { path: "/stats", name: "stats", component: () => import("./views/StatsView.vue") },
    { path: "/etat", name: "health", component: () => import("./views/HealthView.vue") },
    { path: "/reglages", name: "settings", component: () => import("./views/SettingsView.vue") },
    { path: "/connexion", name: "login", component: () => import("./views/LoginView.vue"), meta: { public: true } },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  if (auth.authenticated === null) markAuthenticated((await api.me()).authenticated);
  return auth.authenticated ? true : { name: "login", query: { next: to.fullPath } };
});

setUnauthorizedHandler(() => {
  markAuthenticated(false);
  if (router.currentRoute.value.name !== "login") void router.push({ name: "login", query: { next: router.currentRoute.value.fullPath } });
});

createApp(App).use(router).mount("#app");
