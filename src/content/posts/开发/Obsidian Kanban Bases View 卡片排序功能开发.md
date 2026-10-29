---
title: Obsidian Kanban Bases View 卡片排序功能开发
published: '2026-08-21'
description: >-
  Kanban Bases View 的拖动顺序只能隐式保存，无法写入笔记或供其他视图复用；新增可选 Card order
  属性，按序号排序并在同列、跨列拖动后回写连续序号。
category: 开发
series: ''
slug: 04fe8e2f6415ee6e
tags:
  - 开发
  - Obsidian
  - Kanban-Bases-View
updated: '2026-10-29'
---

# 需求描述

Obsidian Bases 可以通过 Sort 设置卡片的查询顺序，但原生 Card 视图不能通过拖动任意调整卡片顺序。

Kanban Bases View 支持拖动卡片，但该顺序无法存储在显式属性或被其他视图复用。

2026-10-12 核验：Obsidian 1.14.4 已支持原生 Kanban，可跨列更新分组属性并调整列顺序，但尚未提供任意拖动后写回卡片序号的原生功能。通过读取未公开的内部拖动结构增强原生视图，技术上可行，但依赖特定版本。本文继续基于 Kanban Bases View 的公开 Bases API 扩展。当前贡献分支包含上游 0.10.6（`e5fbe3c`），更新的是已有 [PR #108](https://github.com/xiwcx/obsidian-bases-kanban/pull/108)，尚未合并；插件版本号保持上游值，由维护者决定发布版本。

本次开发的目标是在保留原有隐式排序方式的基础上，新增一个可选的 `Card order` 属性：用户需要可见序号时，将拖动结果写入笔记；不配置该属性时，继续使用原有的隐式配置，不增加笔记字段。

# 功能设计

## 新增可选的 Card order 属性

在视图设置中新增一个可选属性。未选择时维持原有的 `cardOrders` 隐式存储；选择后，该属性成为卡片顺序的读取和写入位置。两种模式之间不迁移或清理数据。

```ts
private cardOrderPropertyId: BasesPropertyId | null = null;

private loadConfig(): void {
	this.cardOrderPropertyId = this.config.getAsPropertyId('cardOrderProperty');
}

{
	displayName: 'Card order',
	type: 'property',
	key: 'cardOrderProperty',
	filter: (prop: string) => prop.startsWith('note.'),
	placeholder: 'Optional: card order property',
}
```

## 校验显式属性

Card order 必须是可写的 `note.*` 属性，并且不能与 Group by 或 Swimlane by 使用同一属性。否则重新编号可能改变卡片所属的列或泳道，插件会停止渲染并显示配置错误。

```ts
if (
	this.cardOrderPropertyId &&
	(!this.cardOrderPropertyId.startsWith('note.') ||
		this.cardOrderPropertyId === this.groupByPropertyId ||
		this.cardOrderPropertyId === this.swimlaneByPropertyId)
) {
	this.fullReset();
	this.containerEl.createDiv({
		text: EMPTY_STATE_MESSAGES.CARD_ORDER_PROPERTY_INVALID,
		cls: CSS_CLASSES.EMPTY_STATE,
	});
	return;
}
```

## 按显式序号排列卡片

显式属性接受有限数字和可转换为有限数字的字符串，按数值升序排列。空值和非法值没有显式顺序，统一放在已有序号之后。

```ts
export function readCardOrderValue(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (trimmed === '') return null;
	const numeric = Number(trimmed);
	return Number.isFinite(numeric) ? numeric : null;
}

export function compareCardOrderValues(a: number | null, b: number | null): number {
	if (a === null) return b === null ? 0 : 1;
	if (b === null) return -1;
	return a - b;
}
```

每个列或“泳道 + 列”单元格分别调用该比较逻辑：

```ts
private sortCardEntriesByOrderProperty(entries: BasesEntry[]): BasesEntry[] {
	if (!this.cardOrderPropertyId) return entries;
	return [...entries].sort((a, b) =>
		compareCardOrderValues(
			readCardOrderValue(a.getValue(this.cardOrderPropertyId)?.toString()),
			readCardOrderValue(b.getValue(this.cardOrderPropertyId)?.toString()),
		),
	);
}
```

## 拖动后写回显式序号

同列拖动后，显式模式不再写入 `cardOrders`，而是按照当前 DOM 顺序更新选定属性。

```ts
const paths = getColumnPaths(evt.to);
if (this.cardOrderPropertyId) {
	await this.writeVisibleCardOrder(paths);
} else {
	this._prefs.cardOrders[newKey] = paths;
	this._persistPrefs();
}
```

写回值使用从 1 开始的连续整数。序号在当前可见的每个列或“泳道 + 列”单元格内分别编号，并非全库唯一编号。`skipPath` 用于跳过已经与分组属性一起写入的跨列移动卡片。

不能用 BasesEntry 的查询快照决定是否跳过写入：第一次拖动已修改笔记时，查询可能仍保留旧序号，第二次拖动就可能被误判为无需更新。当前改为通过 `Vault.process` 在原子文件更新回调中读取当前内容；序号已正确时直接返回原文，保留注释、排版和换行，不重新序列化。需要修改时再调用 Obsidian 的公开 YAML 工具。

```ts
private async writeVisibleCardOrder(paths: string[], skipPath?: string): Promise<void> {
	const propertyId = this.cardOrderPropertyId;
	if (!propertyId) return;
	if (!propertyId.startsWith('note.')) {
		throw new Error(`Card order property must be a writable note property: ${propertyId}`);
	}
	if (!this.app?.vault) {
		throw new Error('Vault not available');
	}

	const propertyName = parsePropertyId(propertyId).name;
	const updates = paths.flatMap((path, index) => {
		if (path === skipPath) return [];
		const entry = this._entryMap.get(path);
		if (!entry) throw new Error(`Entry not found for card order: ${path}`);
		const order = index + 1;
		return [this.app.vault.process(entry.file, (content) => updateCardOrderContent(content, propertyName, order))];
	});
	await Promise.all(updates);
}
```

原子更新回调使用以下内容转换函数：

```ts
import { getFrontMatterInfo, parseYaml, stringifyYaml } from 'obsidian';

/** Update the current file atomically; unchanged order preserves its exact bytes. */
export function updateCardOrderContent(content: string, propertyName: string, order: number): string {
	const info = getFrontMatterInfo(content);
	const frontmatter: unknown = info.exists ? (parseYaml(info.frontmatter) ?? {}) : {};
	if (!isFrontmatterRecord(frontmatter)) {
		throw new Error('Card order requires a frontmatter mapping');
	}
	const properties = frontmatter;
	if (readCardOrderValue(properties[propertyName]) === order) return content;
	const updated = stringifyYaml({ ...properties, [propertyName]: order });
	return info.exists ? content.slice(0, info.from) + updated + content.slice(info.to) : `---\n${updated}---\n${content}`;
}

function isFrontmatterRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

跨列拖动新增两步处理：先将移动卡片的新分组值和目标序号写入同一次 frontmatter 更新，再重新编号来源单元格和目标单元格。

```ts
const cardOrderPropertyName = this.cardOrderPropertyId
	? parsePropertyId(this.cardOrderPropertyId).name
	: null;
const cardOrder = newPaths.indexOf(entryPath) + 1;

if (cardOrderPropertyName) frontmatter[cardOrderPropertyName] = cardOrder;

if (this.cardOrderPropertyId) {
	await Promise.all([
		this.writeVisibleCardOrder(oldPaths),
		this.writeVisibleCardOrder(newPaths, entryPath),
	]);
}
```

## 允许 Base Sort 下保存拖动顺序

原实现检测到 Base Sort 后会取消同列拖动，并用 Notice 提示用户清除 Sort。本次移除了 `sortActive`、`hasActiveSort()` 和该提示。现在显式属性始终决定卡片顺序；未配置显式属性时，已有的隐式拖动顺序也不再被 Base Sort 跳过。


# 验证与边界

- 格式化、lint、TypeScript、生产构建及 257 项自动化测试通过。测试覆盖同列、跨列、跨泳道、显式/隐式模式切换、非法属性、查询滞后、写入失败，以及正确序号时原文无变化。
- Obsidian Desktop 1.14.4 的独立测试库中，通过真实鼠标拖动验证同列和跨列排序，检查笔记中的分组属性及序号；实机截图与步骤见 [贡献验证记录](https://github.com/ChrisGray0626/obsidian-bases-kanban/blob/feat/column-sort-direction/docs/card-order/verification.md)。手机实机手势尚未验证。
- 跨单元格移动卡片的分组与序号在同一次 frontmatter 更新中写入，但多笔记重编号不是整体事务。写入失败会向外抛出，已经完成的修改不会自动回滚。
- 当前显式序号和已保存的隐式顺序都优先于 Base Sort；并列序号或未编号卡片保留查询中的相对顺序。这是本次贡献的明确排序语义变化。
- 其他视图需使用一致的过滤、分组和升序序号排序，才能复现看板顺序。需要修改的 YAML 会经过 Obsidian 序列化，原有排版或注释可能改变；序号已正确的文件返回原文。
