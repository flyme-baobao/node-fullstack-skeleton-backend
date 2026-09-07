class UserService {
    token: string | null;

    constructor() {
        this.token = null;
    }

    getToken(): string | null {
        return this.token || localStorage.getItem('access_token');
    }

    setToken(token: string): void {
        this.token = token;
        localStorage.setItem('access_token', token);
    }
}

export const userService = new UserService();