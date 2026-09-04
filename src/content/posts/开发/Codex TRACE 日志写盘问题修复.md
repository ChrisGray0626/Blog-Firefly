---
title: Codex TRACE 日志写盘问题修复
published: '2026-07-08'
description: >-
  Codex 桌面端持续写入大量 TRACE 日志，造成 SQLite WAL 频繁写盘；通过 BEFORE INSERT 触发器忽略
  TRACE，保留其他级别日志并支持回滚。
category: 开发
slug: e38f2b01a758df66
tags:
  - 开发
  - Codex
  - SQLite
---

# 需求描述

Codex 桌面端会将大量 WebSocket 底层事件以 TRACE 级别持续写入 `~/.codex/logs_2.sqlite`。活跃会话中，TRACE 占新增日志的绝大多数，并引发频繁的 SQLite 预写日志（WAL）写入和旧日志清理。

目标是在不影响 INFO、DEBUG、WARN 和 ERROR 日志的前提下停止 TRACE 日志落盘，并确保方案可验证、可回滚。

# 解决方案

在 `logs` 表上创建 `BEFORE INSERT`（插入前）触发器，仅忽略 TRACE 级日志：

```sql
CREATE TRIGGER block_trace_logs
BEFORE INSERT ON logs
WHEN NEW.level = 'TRACE'
BEGIN
  SELECT RAISE(IGNORE);
END;
```

实施前已备份数据库并通过 `PRAGMA quick_check` 完整性检查。安装后连续验证未发现新增 TRACE，其他级别日志正常写入，Codex 活跃窗口的进程写入量明显下降。该方案只阻止 TRACE 日志落盘，不会停止上游日志生成；Codex 更新后需确认该触发器是否仍存在。

回滚命令：

```bash
sqlite3 ~/.codex/logs_2.sqlite "DROP TRIGGER IF EXISTS block_trace_logs;"
```
