import { httpFetch } from './httpFetch';
import { API_PREFIX, SIGNIN_PATH, SIGNUP_PATH } from '@constants/api';
import { showGlobalLoading, hideGlobalLoading } from '@components/loading';

type SigninResponse = {
    token: string;
    user: UserInfo
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

type GetUserInfoResponse = SignupResponse & {
    token: string;
};

const AUTH_PREFIX = `${API_PREFIX}/auth`;

export const signin = async (account: string, password: string): Promise<SigninResponse> => {
    showGlobalLoading();
    return httpFetch<SigninResponse>(`${AUTH_PREFIX}${SIGNIN_PATH}`, {
        method: 'POST',
        data: { account, password },
    }).finally(() => {
        hideGlobalLoading();
    });
}

export const signup = async (request: SignupRequest): Promise<SignupResponse> => {
    const { userName, email, phoneNumber, password } = request;
    showGlobalLoading();
    return httpFetch<SignupResponse>(`${AUTH_PREFIX}${SIGNUP_PATH}`, {
        method: 'POST',
        data: { userName, email, phoneNumber, password },
    }).finally(() => {
        hideGlobalLoading();
    });
}

export const getUserInfo = async (): Promise<GetUserInfoResponse> => {
    return httpFetch<GetUserInfoResponse>(`${AUTH_PREFIX}/users`);
}