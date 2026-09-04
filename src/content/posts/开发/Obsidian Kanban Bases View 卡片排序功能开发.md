---
title: Obsidian Kanban Bases View 卡片排序功能开发
published: '2026-08-21'
description: >-
  Kanban Bases View 的拖动顺序只能隐式保存，无法写入笔记或供其他视图复用；新增可选 Card order
  属性，按序号排序并在同列、跨列拖动后回写连续序号。
category: 开发
slug: 04fe8e2f6415ee6e
tags:
  - 开发
  - Obsidian
  - Kanban-Bases-View
---

# 需求描述

Obsidian Bases 可以通过 Sort 设置卡片的查询顺序，但原生 Card 视图不能通过拖动任意调整卡片顺序。

Kanban Bases View 支持拖动卡片，但该顺序无法存储在显式属性或被其他视图复用。

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

写回值使用从 1 开始的连续整数。已有值正确时不重复修改；`skipPath` 用于跳过已经与分组属性一起写入的跨列移动卡片。

```ts
private async writeVisibleCardOrder(paths: string[], skipPath?: string): Promise<void> {
	const propertyId = this.cardOrderPropertyId;
	if (!propertyId) return;
	if (!propertyId.startsWith('note.')) {
		throw new Error(`Card order property must be a writable note property: ${propertyId}`);
	}
	if (!this.app?.fileManager) {
		throw new Error('File manager not available');
	}

	const propertyName = parsePropertyId(propertyId).name;
	const updates = paths.flatMap((path, index) => {
		if (path === skipPath) return [];
		const entry = this._entryMap.get(path);
		if (!entry) throw new Error(`Entry not found for card order: ${path}`);
		const order = index + 1;
		if (readCardOrderValue(entry.getValue(propertyId)?.toString()) === order) return [];
		return [
			this.app.fileManager.processFrontMatter(entry.file, (frontmatter: Record<string, unknown>) => {
				frontmatter[propertyName] = order;
			}),
		];
	});
	await Promise.all(updates);
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
