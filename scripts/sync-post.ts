import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { z } from "astro/zod";
import { glob } from "glob";
import matter from "gray-matter";
import { ENV_FILE_PATH, POSTS_DIR_PATH } from "./constants";
import { postSlugSchema, readPostPathsBySlug } from "./post-slug";
import type { BasePostRecord } from "./types";

const pathSegmentSchema = z
	.string()
	.trim()
	.min(1)
	.refine(
		(value) => value !== "." && value !== ".." && !/[\0/\\]/.test(value),
		{
			message: "cannot contain path separators or reserved path names",
		},
	);

const publishedSchema = z
	.union([z.date(), z.string().trim()])
	.transform((value) =>
		value instanceof Date ? value.toISOString().slice(0, 10) : value,
	)
	.pipe(z.iso.date({ message: "must be a valid YYYY-MM-DD date" }));

const sourceFrontmatterSchema = z
	.object({
		blog_title: pathSegmentSchema,
		blog_description: z.string().trim().min(1),
		blog_category: pathSegmentSchema,
		blog_published: publishedSchema,
		blog_slug: postSlugSchema,
		tags: z.array(z.string().trim().min(1)).default([]),
	})
	.transform((data) => ({
		title: data.blog_title,
		published: data.blog_published,
		description: data.blog_description,
		category: data.blog_category,
		slug: data.blog_slug,
		tags: data.tags,
	}));

type SourcePost = BasePostRecord & {
	frontmatter: z.output<typeof sourceFrontmatterSchema>;
};

async function main(): Promise<void> {
	const vaultRootPath = readVaultRootPath();
	await fs.access(vaultRootPath);

	const sourcePosts = await readSourcePosts(vaultRootPath);
	const existingPostPathsBySlug = await readPostPathsBySlug();
	assertNoPostSyncConflicts(sourcePosts, existingPostPathsBySlug);
	await writePosts(sourcePosts);
	console.log(`Updated：${sourcePosts.length} articles.`);
}

function readVaultRootPath(): string {
	if (existsSync(ENV_FILE_PATH)) {
		process.loadEnvFile(ENV_FILE_PATH);
	}

	const vaultRoot = process.env.OBSIDIAN_VAULT_ROOT?.trim();
	if (!vaultRoot) {
		throw new Error(`Please set OBSIDIAN_VAULT_ROOT in ${ENV_FILE_PATH}.`);
	}
	return vaultRoot;
}

async function readSourcePosts(vaultRootPath: string): Promise<SourcePost[]> {
	const filePaths = await glob("**/*.md", {
		absolute: true,
		cwd: vaultRootPath,
		ignore: [".obsidian/**", ".trash/**"],
		nodir: true,
	});

	const postsBySlug = new Map<string, SourcePost>();
	for (const filePath of filePaths) {
		const source = await fs.readFile(filePath, "utf8");
		const matterFile = matter(source);
		if (matterFile.data.blog !== true) {
			continue;
		}

		const frontmatter = sourceFrontmatterSchema.safeParse(matterFile.data);
		if (!frontmatter.success) {
			throw new Error(formatFrontmatterError(filePath, frontmatter.error));
		}

		const post: SourcePost = {
			content: matterFile.content,
			filePath,
			frontmatter: frontmatter.data,
		};
		const existingPost = postsBySlug.get(post.frontmatter.slug);
		if (existingPost) {
			throw new Error(
				`Duplicate blog_slug "${post.frontmatter.slug}":\n${existingPost.filePath}\n${filePath}`,
			);
		}
		postsBySlug.set(post.frontmatter.slug, post);
	}

	return Array.from(postsBySlug.values());
}

function assertNoPostSyncConflicts(
	sourcePosts: SourcePost[],
	existingPostPathsBySlug: Map<string, string>,
): void {
	const slugsByPostPath = new Map<string, string>();
	for (const [slug, filePath] of existingPostPathsBySlug) {
		slugsByPostPath.set(filePath, slug);
	}

	for (const post of sourcePosts) {
		const slug = post.frontmatter.slug;
		const filePath = buildPostFilePath(post);
		const existingFilePath = existingPostPathsBySlug.get(slug);
		if (existingFilePath && existingFilePath !== filePath) {
			throw new Error(
				`Post slug "${slug}" already exists at a different path: ${existingFilePath} ${filePath}`,
			);
		}

		const occupyingSlug = slugsByPostPath.get(filePath);
		if (occupyingSlug && occupyingSlug !== slug) {
			throw new Error(
				`Post path is already used by slug "${occupyingSlug}": ${filePath}`,
			);
		}
		slugsByPostPath.set(filePath, slug);
	}
}

async function writePosts(sourcePosts: SourcePost[]): Promise<void> {
	for (const post of sourcePosts) {
		const filePath = buildPostFilePath(post);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(
			filePath,
			matter.stringify(post.content, post.frontmatter),
			"utf8",
		);
	}
}

function buildPostFilePath(post: SourcePost): string {
	return path.join(
		POSTS_DIR_PATH,
		post.frontmatter.category,
		`${post.frontmatter.title}.md`,
	);
}

function formatFrontmatterError(filePath: string, error: z.ZodError): string {
	const issues = error.issues
		.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
		.join("\n");
	return `Invalid blog frontmatter: ${filePath}\n${issues}`;
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
