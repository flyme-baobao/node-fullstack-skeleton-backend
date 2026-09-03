import type { TodoItem } from '../repository/todo.repository.js';

/**
 * 待办相关 DTO：隔离「HTTP 入参」与「展示视图」对底层实体结构（storage 里的 TodoItem）的依赖，
 * 即使存储层字段调整，也只需在此收敛映射，路由/视图层保持稳定。
 */

/** 新增待办的入参（service 负责清洗与校验，controller 只透传） */
export interface CreateTodoDto {
    text: string;
}

/** 待办对外视图（渲染层消费；当前与实体一致，预留演进口） */
export type TodoView = TodoItem & {
    /** 视图层可直接用的格式化时间（用户时区/语言） */
    createTimeFormat: string;
    modifyTimeFormat: string;
    createTimeStamp: number;
    modifyTimeStamp: number;
};