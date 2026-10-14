/** null = pas encore vérifié auprès de l'API. */
export const auth = { authenticated: null as boolean | null };
export const markAuthenticated = (value: boolean) => (auth.authenticated = value);
