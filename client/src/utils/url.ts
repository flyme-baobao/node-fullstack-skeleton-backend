export const getUrlWithParams = (url: string, baseUrl: string, params: Record<string, any>) => {
    const urlObj = new URL(url, baseUrl ?? window.location.origin);
    Object.keys(params).forEach(key => {
        urlObj.searchParams.append(key, params[key]);
    });
    return urlObj.toString();
}