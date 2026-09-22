---
title: Firefly Obsidian 文章同步功能开发
published: '2026-09-02'
description: 以 Obsidian 知识库作为文章唯一内容源，将指定文档单向同步到 Firefly 的文章目录。
category: 开发
series: Firefly 改造计划
slug: 8f0fc83d5f501213
tags:
  - 开发
  - Firefly
  - Obsidian
  - Astro
  - TypeScript
updated: '2026-09-22'
---

# 需求分析

博客文章首先在 Obsidian 中撰写，过去一篇文章准备发布时，需要先复制到 Firefly 的 `src/content/posts` 目录，再把 frontmatter 改写成博客所需的。该流程容易漏掉正文或元数据，或是内容出现更新时需要手动在两侧更新。

# 解决方案

## 基本流程

改造后的流程只保留一个内容源：

```text
Obsidian 中撰写并标记文章
              ↓
        pnpm sync-post
              ↓
src/content/posts/<category>/<title>.md
```

Obsidian 保存可继续编辑的原文，博客目录只保存生成的发布副本。所有待同步文章会先完成字段、slug 和路径校验；检查通过后，缺失的文章被创建，已经存在的文章只有在同步字段或正文发生变化时才会更新。

标记文章和同步博客属于两个不同阶段。

Obsidian 端只负责准备发布元数据。这样可以在写作时决定文章是否发布，并自动填充日期、slug 等过程字段，但不需要知道博客仓库位于哪里，也不负责解释 Astro 的内容结构。

博客端负责扫描、字段转换和文件写入。由博客端脚本统一校验更直接，也避免把博客构建逻辑塞进 Obsidian 端。

两步之间以 frontmatter 为接口：只要源文档满足字段约定，博客脚本就能完成后续工作。

# 功能设计

## 配置知识库路径

在博客项目根目录配置 `.env` ，指定 Obsidian 知识库的绝对路径：

```env
OBSIDIAN_VAULT_ROOT=/absolute/path/to/Obsidian
```

## 标记博客文章

需要发布的文档使用 `blog: true` 标记，并维护以 `blog_` 开头的博客字段：

```yaml
---
blog: true
blog_title: Firefly Obsidian 文章同步功能开发
blog_description: 以 Obsidian 作为唯一内容源，将指定文档同步到 Firefly。
blog_category: 开发
blog_published: 2026-09-02
blog_slug: 8f0fc83d5f501213
blog_series: Firefly 改造计划
tags:
  - Firefly
  - Obsidian
---
```

这些字段可以由 Obsidian 端的 QuickAdd 插件 Macro 调用脚本插入：

```js
module.exports = async ({ app }) => {
	const file = app.workspace.getActiveFile();
	if (!file || file.extension !== "md") {
		throw new Error("Please open your note for blog.");
	}

	await app.fileManager.processFrontMatter(file, (frontmatter) => {
	frontmatter.blog = true;

	const defaults = {
		blog_title: "",
		blog_description: "",
		blog_category: "",
		blog_published: createBlogPublished,
		blog_slug: createBlogSlug,
		blog_series: "",
	};

	for (const [key, value] of Object.entries(defaults)) {
		if (!Object.hasOwn(frontmatter, key)) {
		frontmatter[key] =
			typeof value === "function" ? value() : value;
		}
	}
	});

	new Notice("Blog frontmatter updated!");
};

function createBlogPublished() {
	const today = new Date();
	const year = today.getFullYear();
	const month = String(today.getMonth() + 1).padStart(2, "0");
	const day = String(today.getDate()).padStart(2, "0");

	return `${year}-${month}-${day}`;
}

function createBlogSlug() {
	return require("node:crypto").randomBytes(8).toString("hex");
}
```

## 同步博客文章

`scripts/sync-post.ts` 的入口只组织四个阶段：完整读取源（Obsidian 端）文章、完整读取目标（Firefly 端）文章、检查两端冲突、按变化写入目标文件。

```ts
async function main(): Promise<void> {
  const vaultRootPath = readVaultRootPath();
  await fs.access(vaultRootPath);

  console.log("Reading source and target posts...");
  const sourcePosts = await readSourcePosts(vaultRootPath);
  const targetPostsBySlug = await readTargetPosts();
  assertNoPostSyncConflicts(sourcePosts, targetPostsBySlug);
  await syncPosts(sourcePosts, targetPostsBySlug);
}
```

在博客项目根目录运行：

```bash
pnpm sync-post
```

上面的源文档将写入：

```text
src/content/posts/开发/Firefly Obsidian 文章同步功能开发.md
```

目标文章只保留博客需要的 frontmatter，正文则来自源文档：

```yaml
---
title: Firefly Obsidian 文章同步功能开发
published: '2026-09-02'
description: 以 Obsidian 作为唯一内容源，将指定文档同步到 Firefly。
category: 开发
series: Firefly 改造计划
slug: 8f0fc83d5f501213
tags:
  - Firefly
  - Obsidian
updated: '2026-09-02'
---
```

## 扫描带有 Blog 标记的文档

扫描源（Obsidian 知识库）中的 Markdown 文档，同时跳过 Obsidian 配置和回收站目录：

```ts
const filePaths = await glob("**/*.md", {
  absolute: true,
  cwd: vaultRootPath,
  ignore: [".obsidian/**", ".trash/**"],
  nodir: true,
});
```

源端完整扫描后会分批读取文件，每批最多并行读取 32 个，避免大量云盘文件串行读取时长时间没有响应，也避免一次性并发读取给云盘造成过大压力。读取失败时直接报告具体文件路径。

读取源文档的 frontmatter 和正文，只保留 `blog` 等于 `true` 的文档：

```ts
const matterFile = matter(source);
if (matterFile.data.blog !== true) {
  continue;
}
```

## 校验并转换 Frontmatter

源字段与目标字段存在映射关系，同时应满足相应的校验约束：

| Obsidian 字段        | Firefly 字段    | 约束              |
| ------------------ | ------------- | --------------- |
| `blog_title`       | `title`       | 非空字符串           |
| `blog_description` | `description` | 可缺失或为空          |
| `blog_category`    | `category`    | 非空字符串           |
| `blog_published`   | `published`   | `YYYY-MM-DD`    |
| `blog_slug`        | `slug`        | 非空并复用博客 slug 规则 |
| `blog_series`      | `series`      | 可缺失或为空          |
| `tags`             | `tags`        | 字符串数组，默认为空数组    |

源端和目标端的字段名不同，但转换后使用同一个 `syncFrontmatterSchema`。`sourceFrontmatterSchema` 只负责校验 `blog_*` 字段并完成名称映射，后续比较和写入统一使用转换后的结构。

## 用 Slug 确认身份，用路径确认位置

`title` 和 `category` 可能变化，不能单独作为文章的 ID； `slug` 是业务无关的，正常情况下不会变更，可以用于确认文章的身份，视为文章 ID，用于关联两端的相同文章。

理论上只有相同文章才会写入同一博客端路径，但原则上不同文章也可以配置出相同的路径（仅与 `title` 与 `category` 相关），这可能导致原有文章被覆盖的情况。因此同步前仅检查 `slug` 还不够，还需要建立反向的路径 -> slug 索引，并按以下规则处理：

| 源文章与博客文章的关系      | 结果           |
| ---------------- | ------------ |
| slug 不存在，目标路径未占用 | 新建文章         |
| slug 相同，目标路径相同   | 原地更新         |
| slug 相同，目标路径不同   | 报错，避免保留两个副本  |
| slug 不同，目标路径相同   | 报错，避免覆盖另一篇文章 |

## 写入目标文章

同步以 slug 关联两端文章，并比较转换后的 frontmatter 和 Markdown 正文。比较时不包含目标文章已有的 `updated` 字段：

| 情况 | 写入行为 | `updated` |
| --- | --- | --- |
| 目标文章不存在 | 创建新文章 | 与 `published` 相同 |
| 目标文章存在，内容没有变化 | 不写入文件 | 保留原值 |
| 目标文章存在，frontmatter 或正文发生变化 | 使用源文档覆盖 | 更新为同步当天日期 |

因此重复运行同步命令不会主动覆盖未变化的文章，也不会无故刷新文件修改时间和 `updated`。发生变化时，博客副本中额外添加但源端没有对应字段的 frontmatter 仍不会保留。

同步完成后输出本次创建、更新和未变化的文章数量：

```text
Created: 1, updated: 2, unchanged: 3.
```
