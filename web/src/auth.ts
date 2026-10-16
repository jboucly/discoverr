/** null = not checked with the API yet. */
export const auth = { authenticated: null as boolean | null };
export const markAuthenticated = (value: boolean) => (auth.authenticated = value);
