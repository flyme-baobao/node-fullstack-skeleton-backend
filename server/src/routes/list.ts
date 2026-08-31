import express from 'express';
import * as todoController from '../controller/todo.controller.js';
import { PAGE_PREFIX } from '../constants/api.js';

const router = express.Router();

// 待办数据路由，返回可被 htmx 替换的局部片段（partials/ 模板由 middleware 绕过 layout 渲染）。
// 页面路由（/、/list 整页渲染）在 routes/pages.js，清单数据（增删改）集中在本模块。
// 本层只做「路径→handler」的薄委托，真正的请求处理在 controller，业务逻辑在 service。

const TODOS_PATH = `${PAGE_PREFIX}/todos`; // 待办清单页 /page/list
// 局部片段：供 htmx 刷新列表（hx-get /todos -> #todo-list）
router.get(TODOS_PATH, todoController.listFragment);

// 添加待办：返回局部片段，htmx 用它替换 #todo-list
router.post(TODOS_PATH, todoController.createTodo);

// 切换完成状态：返回局部片段
router.post(`${TODOS_PATH}/:id/toggle`, todoController.toggleTodo);

// 删除待办
router.delete(`${TODOS_PATH}/:id`, todoController.removeTodo);

export { router as listRouter };