import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import type { AstroIntegration } from "astro";
import { z } from "astro/zod";
import { glob } from "glob";
import matter from "gray-matter";
import { pinyin } from "pinyin-pro";
import type { PostSlugMode } from "@/types/siteConfig.ts";
import { POSTS_DIR_PATH } from "./constants";
import type { BasePostRecord } from "./types";

export type BuiltPostSlug = {
	filePath: string;
	slug: string;
};

export const postSlugSchema = z.string().trim().min(1);

const postFrontmatterSchema = z.object({
	title: z.string().trim().min(1),
	slug: postSlugSchema.nullish().transform((slug) => slug || null),
});

type PostRecord = BasePostRecord & {
	frontmatter: BasePostRecord["frontmatter"] &
		z.output<typeof postFrontmatterSchema>;
};

type PostState = {
	postsMissingSlug: PostRecord[];
	postsBySlug: Map<string, PostRecord>;
};

type BuildPostSlugsOptions = {
	mode: PostSlugMode;
	postsDirectory?: string;
	write: boolean;
};

export function createPostSlug(title: string, mode: PostSlugMode): string {
	switch (mode) {
		case "random":
			return createRandomSlug();
		case "pinyin":
			return createPinyinSlug(title);
	}
}

export async function assertPostSlugAvailable(
	slug: string,
	postsDirectory: string = POSTS_DIR_PATH,
): Promise<void> {
	const { postsBySlug } = await readPostState(postsDirectory);
	const existingPost = postsBySlug.get(slug);

	if (existingPost) {
		throw new Error(
			`Post slug "${slug}" is already used by ${existingPost.filePath}`,
		);
	}
}

export async function readPostPathsBySlug(
	postsDirectory: string = POSTS_DIR_PATH,
): Promise<Map<string, string>> {
	const { postsMissingSlug, postsBySlug } = await readPostState(postsDirectory);
	assertNoMissingSlugs(postsMissingSlug);

	const postPathsBySlug = new Map<string, string>();
	for (const [slug, post] of postsBySlug) {
		postPathsBySlug.set(slug, post.filePath);
	}
	return postPathsBySlug;
}

export function postSlugIntegration(mode: PostSlugMode): AstroIntegration {
	return {
		name: "post-slug",
		hooks: {
			"astro:config:setup": async ({ command, logger }) => {
				const builtSlugs = await buildPostSlugs({
					mode,
					write: command === "dev",
				});

				for (const { filePath, slug } of builtSlugs) {
					logger.info(`Generated post slug: ${filePath} -> ${slug}`);
				}
			},
		},
	};
}

export async function buildPostSlugs({
	mode,
	postsDirectory = POSTS_DIR_PATH,
	write,
}: BuildPostSlugsOptions): Promise<BuiltPostSlug[]> {
	const { postsMissingSlug, postsBySlug } = await readPostState(postsDirectory);

	if (!write) {
		assertNoMissingSlugs(postsMissingSlug);
		return [];
	}

	const builtPosts = postsMissingSlug.map((post) => {
		const slug = createPostSlug(post.frontmatter.title, mode);
		const existingPost = postsBySlug.get(slug);
		if (existingPost) {
			throw new Error(
				`Built slug "${slug}" conflicts between ${post.filePath} and ${existingPost.filePath}`,
			);
		}

		const builtPost = {
			...post,
			frontmatter: { ...post.frontmatter, slug },
		};
		postsBySlug.set(slug, builtPost);
		return builtPost;
	});

	for (const post of builtPosts) {
		await fs.writeFile(
			post.filePath,
			matter.stringify(post.content, post.frontmatter),
			"utf8",
		);
	}

	return builtPosts.map(({ filePath, frontmatter }) => ({
		filePath,
		slug: frontmatter.slug,
	}));
}

function createRandomSlug(): string {
	return randomBytes(8).toString("hex");
}

function createPinyinSlug(title: string): string {
	const slug = pinyin(title, { nonZh: "consecutive", toneType: "none" })
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

	if (!slug) {
		throw new Error(`Unable to generate a slug from the post title: ${title}`);
	}

	return slug;
}

async function readPostState(postsDirectory: string): Promise<PostState> {
	const filePaths = await glob("**/*.{md,mdx}", {
		absolute: true,
		cwd: postsDirectory,
		nodir: true,
	});

	const postsMissingSlug: PostRecord[] = [];
	const postsBySlug = new Map<string, PostRecord>();

	for (const filePath of filePaths) {
		const fileContents = await fs.readFile(filePath, "utf8");
		if (!matter.test(fileContents)) {
			throw new Error(`Post is missing YAML frontmatter: ${filePath}`);
		}

		const parsedPost = matter(fileContents);
		const frontmatter = postFrontmatterSchema.parse(parsedPost.data);

		const post: PostRecord = {
			content: parsedPost.content,
			filePath,
			// Preserve unrelated frontmatter when a missing slug is written back.
			frontmatter: { ...parsedPost.data, ...frontmatter },
		};

		if (!post.frontmatter.slug) {
			postsMissingSlug.push(post);
			continue;
		}

		const slug = post.frontmatter.slug;
		const existingPost = postsBySlug.get(slug);
		if (existingPost) {
			throw new Error(
				`Duplicate post slug "${slug}": used by both ${existingPost.filePath} and ${post.filePath}`,
			);
		}

		postsBySlug.set(slug, post);
	}

	return { postsMissingSlug, postsBySlug };
}

function assertNoMissingSlugs(posts: PostRecord[]): void {
	if (posts.length === 0) {
		return;
	}

	throw new Error(
		`The following posts are missing a slug:\n${posts.map((post) => post.filePath).join("\n")}\nRun pnpm dev to generate them.`,
	);
}
