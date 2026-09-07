const ACCESS_TOKEN_KEY = 'access_token';

class UserService {
    private tokenCache: string | null = null;

    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('storage', (e) => {
                if (e.key === ACCESS_TOKEN_KEY) {
                    this.tokenCache = e.newValue;
                }
            });
        }
    }

    getToken(): string | null {
        if (this.tokenCache) {
            return this.tokenCache;
        }
        const persist = localStorage.getItem(ACCESS_TOKEN_KEY);
        this.tokenCache = persist;
        return persist;
    }

    setToken(token: string): void {
        this.tokenCache = token;
        localStorage.setItem(ACCESS_TOKEN_KEY, token);
    }

    clearToken(): void {
        this.tokenCache = null;
        localStorage.removeItem(ACCESS_TOKEN_KEY);
    }
}

export const userService = new UserService();
