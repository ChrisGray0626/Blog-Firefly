---
title: 基于 SSH 反向端口转发的服务器联网代理
published: '2026-08-08'
description: 服务器无法直接联网，apt 和 uv 无法更新依赖；通过 SSH 反向端口转发复用本机 Clash 代理，并为 apt 与环境变量配置本地代理端口。
category: 开发
slug: 1512e01217fe64c7
tags:
  - 开发
  - SSH
  - 反向代理
---

# 需求描述

当前服务器本身无法直接访问互联网，但存在稳定的联网下载需求，主要包括以下两类场景：

1. 使用 `apt` 更新系统源、安装系统依赖；
2. 使用 `uv` 安装 Python、安装项目依赖。

本机具备可用的代理环境，代理软件为 Clash Verge，代理端口为 `7897` 。因此目标是让服务器通过 SSH 隧道复用本机的代理出口访问互联网。

# 解决方案

## 整体流程

```text
服务器 apt / uv
	↓
服务器 127.0.0.1:7897
	↓
SSH 反向端口转发
	↓
本机 Clash Verge 127.0.0.1:7897
	↓
互联网
```

## 建立 SSH 反向端口转发

在本机执行以下命令：

```bash
ssh -R 127.0.0.1:7897:127.0.0.1:7897 \
  user@server_ip
```

执行 `expect` 脚本：

```bash
#!/usr/bin/expect -f

set timeout -1

set SSH_USER "root"
set HOST "10.130.10.166"
set PORT "30412"
set PASSWORD ""

spawn ssh \
  -p $PORT \
  -R 127.0.0.1:7897:127.0.0.1:7897 \
  $SSH_USER@$HOST

expect {
  "*yes/no*" {
    send -- "yes\r"
    exp_continue
  }
  -re {.*assword.*} {
    send -- "$PASSWORD\r"
  }
}

interact
```

## 测试代理链路

建立隧道后，在服务器上测试代理是否可用：

```bash
curl -I -x http://127.0.0.1:7897 https://pypi.org
```

## 配置 `apt` 代理

在服务器上创建或覆盖 `apt` 代理配置：

```bash
sudo tee /etc/apt/apt.conf.d/95proxy > /dev/null <<'EOF'
Acquire::http::Proxy "http://127.0.0.1:7897";
Acquire::https::Proxy "http://127.0.0.1:7897";
EOF
```

然后执行：

```bash
sudo apt update
```

## 配置 `uv` 代理

`uv` 可以直接使用环境变量中的 HTTP/HTTPS 代理配置。建议写入服务器的 `/etc/environment` ：

```bash
cat >> ~/.bashrc <<'EOF'

export HTTP_PROXY=http://127.0.0.1:7897
export HTTPS_PROXY=http://127.0.0.1:7897
export ALL_PROXY=http://127.0.0.1:7897
export NO_PROXY=localhost,127.0.0.1,::1
EOF
```

然后执行

```bash
source ~/.bashrc
```
