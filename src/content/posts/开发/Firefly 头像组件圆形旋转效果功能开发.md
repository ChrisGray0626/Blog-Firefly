---
title: Firefly 头像组件圆形旋转效果功能开发
published: '2026-08-28'
description: 侧边栏头像原为静态方形，缺少悬停反馈；通过正方形约束和圆形裁切统一外观，并为内部图片添加悬停旋转与移出归位动画。
category: 开发
slug: 339b7202f83f6b9b
tags:
  - 开发
  - Firefly
  - Astro
  - Tailwind-CSS
  - CSS
---

# 需求描述

Firefly 侧边栏的个人资料头像当前为正方形静态效果，希望改为鼠标悬停时旋转一圈，移开时反向旋转归位的效果。为适配该效果，头像应同步修改为圆形，尺寸也可以有所调整。

# 功能设计

## 自适应圆形头像组件

`src/components/widget/Profile.astro` 的头像组件保留响应式最大宽度，增加正方形约束和圆形裁切：

```astro
class="group block relative mx-auto mt-1 lg:mt-0 mb-3
  max-w-36 lg:max-w-48 aspect-square overflow-hidden rounded-full active:scale-95"
```

- `aspect-square` ：容器高度始终等于宽度，即使源图片不是正方形。
- `overflow-hidden rounded-full`：将容器及内部内容裁为圆形。

## 悬停旋转

```css
:global(.profile-avatar-image) {
  transition: transform 1s ease-out;
}

.group:hover :global(.profile-avatar-image) {
  transform: rotate(360deg);
}
```

- `transform 1s ease-out` ：设置动画为一秒，效果为以慢速结束的过渡动画。
- `rotate(360deg)` ：旋转 360 度。

该元素为 `ImageWrapper` 生成的图片包装元素的内部元素，故样式需要使用 `:global()` 才能命中内部组件 `profile-avatar-image` 。
