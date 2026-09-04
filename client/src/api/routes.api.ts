import { API_PREFIX } from '@constants/api';

export const getSpaRoutes = () => {
    return fetch(`${API_PREFIX}/__routes`);
}