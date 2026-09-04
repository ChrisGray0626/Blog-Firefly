---
title: Obsidian Douban 插件图片上传 PicGo 功能修复
published: '2026-03-27'
description: >-
  豆瓣图片因 Referer 校验无法下载，部分 WebP 又无法通过 Electron 剪贴板上传；补充请求头、修正高清图地址、等待剪贴板写入，并在
  WebP 解析失败时转为 PNG。
category: 开发
slug: 9ab89d31cf793aab
tags:
  - 开发
  - Obsidian
  - Obsidian-Douban
  - PicGo
---

# 需求描述

1. 豆瓣图片访问策略发生变化，访问 doubanio 图片链接时需要附带有效的 Referer 请求头，否则会被拒绝访问。
2. 插件原有的 PicGo 上传链路依赖系统剪贴板，部分 webp 在写入剪贴板时无法被当前 Electron 运行时直接解析，最终导致上传失败。

# 功能设计

## 图片请求新增 Header `Referer`

图片请求时，使用豆瓣条目页地址作为 `Referer`，并在原有请求头基础上清理不适用于图片请求的字段，保证图片能够正常下载。

## 高清图地址改为使用远端文件名生成

高清图地址生成时，不再使用本地附件文件名拼接，而是从原始图片 URL 中提取远端文件名，避免生成错误的高清图地址。

## 剪贴板写入新增显式等待

保留原有 PicGo 剪贴板上传流程，仅在上传前显式等待剪贴板写入完成，避免写入未完成时提前上传。

```ts
.then(async (buffer) => {
	if (!buffer || buffer.byteLength == 0) {
		throw new Error(i18nHelper.getMessage('130109'));
	}
	await ClipboardUtil.writeImage(buffer);
	return await this.uploadClipboardFile(context);
})

```

## Webp 格式图片处理

仍优先使用原有方式写入剪贴板；仅当 webp 图片无法被 Electron 直接解析时，再通过 canvas 转为 png 后写入，保证对原有逻辑改动最小。

```ts
private static async createNativeImageFromWebp(data: ArrayBuffer) {
	const { nativeImage } = require('electron');
	const imageElement = await this.loadImage(URL.createObjectURL(new Blob([data], {type: 'image/webp'})));
	try {
		const canvas = document.createElement('canvas');
		canvas.width = imageElement.naturalWidth || imageElement.width;
		canvas.height = imageElement.naturalHeight || imageElement.height;
		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error(i18nHelper.getMessage('130110'));
		}
		context.drawImage(imageElement, 0, 0);
		return nativeImage.createFromDataURL(canvas.toDataURL('image/png'));
	} finally {
		imageElement.src = '';
	}
}

```
