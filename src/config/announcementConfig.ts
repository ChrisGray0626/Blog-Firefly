import type { AnnouncementConfig } from "../types/announcementConfig";

export const announcementConfig: AnnouncementConfig = {
	// 公告标题，留空则走i18n默认标题
	title: "【宇宙安全声明】",

	// 公告内容
	content:
		"本网站严格遵守地球及全宇宙现行与未来适用的法律法规、文明公约及时空秩序，坚决维护国家安全、世界和平、星际稳定与宇宙安全。",

	// 是否允许用户关闭公告
	closable: true,

	link: {
		// 启用链接
		enable: false,
		// 链接文本
		text: "了解更多",
		// 链接 URL
		url: "/about/",
		// 内部链接
		external: false,
	},
};
