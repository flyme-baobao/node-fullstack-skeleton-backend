declare type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
declare type RequiredProperty<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;