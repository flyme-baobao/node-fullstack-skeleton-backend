import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../server/src/app.ts';
import { mountRoutes } from '../../server/src/routes/index.ts';

// 组装一个不含前端中间件的 app 供 supertest 驱动
const buildApp = async () => {
    const app = await createApp();
    mountRoutes(app);
    return app;
};

describe('GET /', () => {
    it('返回 200 且渲染首页（hero 标题）', async () => {
        const res = await request(await buildApp()).get('/');
        assert.equal(res.status, 200);
        assert.match(res.text, /高效办，待办清单/);
    });
});

describe('GET /api/__routes', () => {
    it('返回合法路径清单（由 PAGE_META 派生，不含 /page 前缀）', async () => {
        const res = await request(await buildApp()).get('/api/__routes');
        assert.equal(res.status, 200);
        const body = res.body as { valid: string[]; base: string };
        assert.ok(Array.isArray(body.valid), 'valid 应为数组');
        assert.ok(body.valid.includes('/'), '应含基路径 /');
        assert.ok(body.valid.includes('/list'), '应含 /list');
        // 派生清单不应带 /page 前缀（那是内部注册路径，非浏览器可见）
        assert.ok(!body.valid.some((p) => p.startsWith('/page')));
        assert.equal(body.base, '/');
    });
});

describe('GET /list', () => {
    it('返回待办清单页（含表单 + #todo-list）', async () => {
        const res = await request(await buildApp()).get('/list');
        assert.equal(res.status, 200);
        assert.match(res.text, /待办清单/);      // todos.title
        assert.match(res.text, /<form/);          // 新增表单
        assert.match(res.text, /todo-list/);       // htmx 交换目标
    });
});

describe('GET /todos', () => {
    it('返回待办列表局部片段', async () => {
        const res = await request(await buildApp()).get('/todos');
        assert.equal(res.status, 200);
        assert.match(res.text, /todo-list/);
    });
});

describe('POST /todos', () => {
    it('新增待办并返回局部片段', async () => {
        const res = await request(await buildApp())
            .post('/todos')
            .type('form')
            .send({ text: '写一轮测试' });
        assert.equal(res.status, 200);
        assert.match(res.text, /写一轮测试/);
    });
});

describe('POST /todos/:id/toggle', () => {
    it('切换完成状态', async () => {
        const res = await request(await buildApp()).post('/todos/1/toggle');
        assert.equal(res.status, 200);
        assert.match(res.text, /学习 htmx/);
    });
});