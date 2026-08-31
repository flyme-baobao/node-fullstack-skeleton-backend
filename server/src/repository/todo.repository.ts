import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 数据文件放在项目根目录下的 data/todos.json
const DATA_DIR = path.join(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'todos.json');

/** 待办实体 */
export interface TodoItem {
    id: number;
    text: string;
    done: boolean;
}

/** 落盘结构：待办数组 + 自增游标 */
export interface TodosData {
    todos: TodoItem[];
    nextId: number;
}

// 读取：如果文件不存在，返回默认初始数据
function loadTodos(): TodosData {
    if (!existsSync(DATA_FILE)) {
        return {
            todos: [
                { id: 1, text: '学习 htmx', done: true },
                { id: 2, text: '接入 Vite + Express', done: false },
            ],
            nextId: 3,
        };
    }
    try {
        const raw = readFileSync(DATA_FILE, 'utf-8');
        return JSON.parse(raw) as TodosData;
    } catch (err) {
        logger.error('读取数据文件失败，使用空数据启动', { error: String(err) });
        return { todos: [], nextId: 1 };
    }
}

// 写入：原子性 —— 先保证目录存在，再整体覆盖写入
function saveTodos({ todos, nextId }: TodosData): void {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify({ todos, nextId }, null, 2), 'utf-8');
}

/**
 * 待办数据仓库（repository / 模块级单例）：
 * 同时负责「文件持久化（data/todos.json）」与「内存态管理」，向上层（service）屏蔽读写细节。
 * 启动时只 load 一次，内存中的 todos / nextId 是全应用共享的同一份引用。
 */
const loaded = loadTodos();
const todos: TodoItem[] = loaded.todos;
let nextId: number = loaded.nextId;

// 每次增删改后，把最新内存状态写回磁盘
function persist(): void {
    saveTodos({ todos, nextId });
}

/** 列表（外部只读引用，实际仍然共享可变数组） */
export function list(): TodoItem[] {
    return todos;
}

/** 新增：返回新条目 */
export function create(text: string): TodoItem {
    const item: TodoItem = { id: nextId++, text, done: false };
    todos.unshift(item);
    persist();
    return item;
}

/** 切换完成状态：返回该条目（找不到返回 undefined） */
export function toggle(id: number): TodoItem | undefined {
    const todo = todos.find((t) => t.id === id);
    if (!todo) return undefined;
    todo.done = !todo.done;
    persist();
    return todo;
}

/** 删除：返回是否删到了（找不到 false） */
export function remove(id: number): boolean {
    const index = todos.findIndex((t) => t.id === id);
    if (index === -1) return false;
    todos.splice(index, 1);
    persist();
    return true;
}