---
image: ""
lang: ""
published: 2026-08-30
description: 文章 slug 依赖标题拼音，标题变化后链接容易失配；新增随机 slug 模式，在开发阶段补全缺失值，并在新建文章时按分类与标题创建文件、生成并校验唯一 slug。
category: 开发
slug: 069ba0f6eb66dbf0
series: Firefly 改造计划
updated: 2026-09-04
title: Firefly 文章 slug 自动生成功能开发
tags:
  - 开发
  - Firefly
  - Astro
  - TypeScript
---

# 需求描述

当前 Firefly 的文章 `slug` 仅支持依赖文章标题的拼音转写的生成模式，该模式与文章标题强耦合，文章标题修改会导致其与链接不一致。希望新增一种业务无关的 `slug` 模式，同时支持自动检测并补全缺失 `slug` 的文章。

# 功能设计

## 新增 `Slug` 模式配置

在文章内容页配置中增加 `slug` 模式配置项：

```ts
post: {
  slug: "random",
}
```

配置类型同步新增：

```ts
slug: "pinyin" | "random";
```

其他模块通过 `PostSlugMode` 复用该配置项的派生类型，避免再次定义相同的模式范围。

```ts
export type PostSlugMode = SiteConfig["post"]["slug"];
```

## 生成业务无关的随机 Slug

`random` 模式使用 Node.js 的 `crypto.randomBytes` 生成 8 字节随机数，再转换为 16 位小写十六进制字符串。

```ts
function createRandomSlug(): string {
  return randomBytes(8).toString("hex");
}
```

随机值不读取文章标题、正文、分类或路径，因此这些业务内容发生变化时不会影响已写入的 slug。

## 统一 Slug 校验

随机 slug 和拼音 slug 的格式不同，因此公共校验只要求 slug 是非空字符串：

```ts
export const postSlugSchema = z.string().trim().min(1);
```

文章扫描、新建文章和 Obsidian 文章同步复用同一规则，避免不同脚本分别定义 slug 格式。

## `setup` 生命周期阶段补全 Slug

通过 Astro Integration 接入配置生命周期：

```ts
integrations: [
  postSlugIntegration(siteConfig.post.slug),
]
```

该 Integration 在 `astro:config:setup` 阶段检查文章，仅允许 `dev` 命令写入缺失的 slug：

```ts
const builtSlugs = await buildPostSlugs({
  mode,
  write: command === "dev",
});
```

运行 `pnpm dev` 时，缺少 `slug` 的文章会生成随机 slug 并写回 frontmatter。已有非空 `slug` 不会重新生成。运行构建、检查、Astro 同步或预览命令时只进行校验，如果仍有文章缺少 `slug` ，流程会报错提醒。

## 创建文章时直接生成随机 Slug

新建文章命令接收必填的分类和可选的标题：

```bash
pnpm new-post <category> [title]
```

标题为空时使用 `buildPublishedDate()` 生成的发布日期，随后直接以分类和标题生成 `src/content/posts/<category>/<title>.md`。当前配置为 `random` 时，新文章会立即得到 16 位随机 slug。写入文件前还会检查该值是否已被其他文章占用：

```ts
const published = buildPublishedDate();
const title = titleArgument || published;
const filePath = buildPostFilePath(category, title);
const slug = createPostSlug(title, siteConfig.post.slug);
await assertPostSlugAvailable(slug);
```

检查通过后，随机 slug 与其他 frontmatter 字段一同写入新文章，使文章从创建时开始就使用稳定的访问路径。文件名由标题决定，访问路径由 slug 决定，二者互不替代。
