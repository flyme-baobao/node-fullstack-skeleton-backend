import { API_PREFIX } from '@constants/api';
import { httpFetch } from './httpFetch';
export const getSpaRoutes = <T>() => {
    return httpFetch<T>(`${API_PREFIX}/__routes`);
}