/**
 * Intl 时间格式化（timeFormat.ts）——utils 里唯一接触 Intl 的地方。
 *
 * 两个消费方（都只传「参数」，不各自 new Intl）：
 *  - logger.ts：进程本地时间（TZ 决定时区，sv-SE 出可排序格式）→ formatInTimeZone
 *  - utils/userTime.ts：用户上下文（req.userTimeZone / req.userLocale）→ formatUserDateTime
 *
 * 设计要点：
 *  - Intl.DateTimeFormat 构造成本较高，实例按「locale|timeZoneId|选项串」缓存复用；
 *  - Date 由调用方传入（要格式化哪个时刻、何时取 now，都是调用方的决策），
 *    本模块不偷用 new Date()，保持纯函数语义，方便测试与复用。
 */
const formatCache = new Map<string, Intl.DateTimeFormat>();

/** 组装 formatter 的内部复用：缓存 key 只由 locale/时区/选项序列化而来（与 date 无关） */
function getFormatter({
    locale, timeZone, options, cacheKeyPrefix
}: {
    locale: string, timeZone: string, options: Intl.DateTimeFormatOptions, cacheKeyPrefix: string
}): Intl.DateTimeFormat {
    const key = `${cacheKeyPrefix}|${locale}|${timeZone}|${JSON.stringify(options)}`;
    let formatter = formatCache.get(key);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone });
        formatCache.set(key, formatter);
    }
    return formatter;
}
/** 默认输出：可排序的 YYYY-MM-DD HH:mm:ss（logger tsLocal 场景） */
const defaultFormatOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
}

/**
 * 通用格式化内核：任意 locale + 任意 IANA 时区 + 任意 DateTimeFormat 选项 + 任意时刻。
 * @param locale     BCP 47 语言标签（如 'sv-SE' / 'zh-CN' / 'en-US'），决定月名、12/24 小时等习惯
 * @param timeZoneId IANA 时区（如 'Asia/Shanghai' / 'UTC'），决定钟面换算
 * @param date       要格式化的时刻（调用方决定传 now 还是 DB 取回的时间）
 * @param options    Intl.DateTimeFormatOptions（dateStyle/timeStyle 或组件选项）
 */
/** 参数包：locale + 时区 + 时刻 + Intl 组件选项（options 缺省用可排序格式） */
interface FormatInTimeZoneParams {
    /** BCP 47 语言标签（如 'sv-SE' / 'zh-CN' / 'en-US'） */
    locale: string;
    /** IANA 时区（如 'Asia/Shanghai' / 'UTC'） */
    timeZone: string;
    /** 要格式化的时刻（调用方决定传 now 还是 DB 取回的时间） */
    date: Date;
    /** Intl.DateTimeFormatOptions（dateStyle/timeStyle 或组件选项） */
    options?: Intl.DateTimeFormatOptions;
}
type FormatInTimeZonePartsParams = RequiredProperty<FormatInTimeZoneParams, 'options'>;

export function formatInTimeZone({ locale, timeZone, date, options = defaultFormatOptions }: FormatInTimeZoneParams): string {
    return getFormatter({ locale, timeZone, options, cacheKeyPrefix: 'fmt' }).format(date);
}

/** formatToParts 变体：调用方需要拆分部件（如提取 timeZoneName 偏移/区名）时用。 */
export function formatInTimeZoneParts({ locale, timeZone, date, options }: FormatInTimeZonePartsParams): Intl.DateTimeFormatPart[] {
    return getFormatter({ locale, timeZone, options, cacheKeyPrefix: 'parts' }).formatToParts(date);
}

