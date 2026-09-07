import { httpFetch } from './httpFetch';
import { API_PREFIX } from '@constants/api';
type UserInfo = {
    userId: string;
    userName: string;
    email: string | null;
    phoneNumber: string | null;
    createdAt: Date;

}
type SigninResponse = {
    token: string;
    user?: UserInfo
};

type SignupRequest = {
    userName: string;
    email: string | null;
    phoneNumber: string | null;
    password: string;
};

type SignupResponse = {
    user: UserInfo;
};

type GetUserInfoResponse = SignupResponse;

export const signin = async (account: string, password: string): Promise<SigninResponse> => {
    return httpFetch<SigninResponse>(`${API_PREFIX}/signin`, {
        method: 'POST',
        data: { account, password },
    });
}

export const signup = async (request: SignupRequest): Promise<SignupResponse> => {
    const { userName, email, phoneNumber, password } = request;
    return httpFetch<SignupResponse>(`${API_PREFIX}/signup`, {
        method: 'POST',
        data: { userName, email, phoneNumber, password },
    });
}

export const getUserInfo = async (): Promise<GetUserInfoResponse> => {
    return httpFetch<GetUserInfoResponse>(`${API_PREFIX}/auth/users`);
}