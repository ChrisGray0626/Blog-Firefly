import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { z } from "astro/zod";
import { glob } from "glob";
import matter from "gray-matter";
import { ENV_FILE_PATH, POSTS_DIR_PATH } from "./constants";
import { textSchema } from "./post-slug";
import type { BasePostRecord } from "./types";

const publishedSchema = z
	.union([z.date(), z.string().trim()])
	.transform((value) =>
		value instanceof Date ? value.toISOString().slice(0, 10) : value,
	)
	.pipe(z.iso.date({ message: "must be a valid YYYY-MM-DD date" }));

const optionalTextSchema = z.string().trim().optional().default("");
const tagsSchema = z.array(textSchema);

const syncFrontmatterSchema = z.object({
	title: textSchema,
	published: publishedSchema,
	description: optionalTextSchema,
	category: textSchema,
	series: optionalTextSchema,
	slug: textSchema,
	tags: tagsSchema.default([]),
});

const sourceFrontmatterSchema = z
	.object({
		blog_title: textSchema,
		blog_description: optionalTextSchema,
		blog_category: textSchema,
		blog_series: optionalTextSchema,
		blog_published: publishedSchema,
		blog_slug: textSchema,
		tags: tagsSchema.default([]),
	})
	.transform((data) =>
		syncFrontmatterSchema.parse({
			title: data.blog_title,
			published: data.blog_published,
			description: data.blog_description,
			category: data.blog_category,
			series: data.blog_series,
			slug: data.blog_slug,
			tags: data.tags,
		}),
	);

type SyncPost = BasePostRecord & {
	frontmatter: z.output<typeof syncFrontmatterSchema>;
};

type ParsedMatterFile = {
	filePath: string;
	matterFile: ReturnType<typeof matter>;
};

async function main(): Promise<void> {
	const vaultRootPath = readVaultRootPath();
	await fs.access(vaultRootPath);

	console.log("Reading source posts...");
	const sourcePosts = await readSourcePosts(vaultRootPath);
	console.log("Reading target posts...");
	const targetPostsBySlug = await readTargetPosts();
	assertNoPostSyncConflicts(sourcePosts, targetPostsBySlug);
	await syncPosts(sourcePosts, targetPostsBySlug);
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

async function readSourcePosts(vaultRootPath: string): Promise<SyncPost[]> {
	const filePaths = await glob("**/*.md", {
		absolute: true,
		cwd: vaultRootPath,
		ignore: [".obsidian/**", ".trash/**"],
		nodir: true,
	});

	const matterFiles = await readMatterFiles(filePaths);
	const postsBySlug = new Map<string, SyncPost>();
	for (const { filePath, matterFile } of matterFiles) {
		if (matterFile.data.blog !== true) {
			continue;
		}

		const frontmatter = sourceFrontmatterSchema.safeParse(matterFile.data);
		if (!frontmatter.success) {
			throw new Error(formatFrontmatterError(filePath, frontmatter.error));
		}

		const post: SyncPost = {
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

async function readTargetPosts(): Promise<Map<string, SyncPost>> {
	const filePaths = await glob("**/*.{md,mdx}", {
		absolute: true,
		cwd: POSTS_DIR_PATH,
		nodir: true,
	});

	const matterFiles = await readMatterFiles(filePaths);
	const postsBySlug = new Map<string, SyncPost>();
	for (const { filePath, matterFile } of matterFiles) {
		const frontmatter = syncFrontmatterSchema.safeParse(matterFile.data);
		if (!frontmatter.success) {
			throw new Error(formatFrontmatterError(filePath, frontmatter.error));
		}

		const post: SyncPost = {
			content: matterFile.content,
			filePath,
			frontmatter: frontmatter.data,
		};
		const existingPost = postsBySlug.get(post.frontmatter.slug);
		if (existingPost) {
			throw new Error(
				`Duplicate post slug "${post.frontmatter.slug}":\n${existingPost.filePath}\n${filePath}`,
			);
		}
		postsBySlug.set(post.frontmatter.slug, post);
	}
	return postsBySlug;
}

async function readMatterFiles(
	filePaths: string[],
): Promise<ParsedMatterFile[]> {
	const matterFiles: ParsedMatterFile[] = [];
	const batchSize = 32;
	for (let index = 0; index < filePaths.length; index += batchSize) {
		const batch = filePaths.slice(index, index + batchSize);
		const parsedBatch = await Promise.all(
			batch.map(async (filePath) => {
				try {
					return {
						filePath,
						matterFile: matter(await fs.readFile(filePath, "utf8")),
					};
				} catch (error) {
					throw new Error(`Failed to read post: ${filePath}`, { cause: error });
				}
			}),
		);
		matterFiles.push(...parsedBatch);
	}
	return matterFiles;
}

function assertNoPostSyncConflicts(
	sourcePosts: SyncPost[],
	targetPostsBySlug: Map<string, SyncPost>,
): void {
	const slugsByPostPath = new Map<string, string>();
	for (const [slug, post] of targetPostsBySlug) {
		slugsByPostPath.set(post.filePath, slug);
	}

	for (const post of sourcePosts) {
		const slug = post.frontmatter.slug;
		const filePath = buildPostFilePath(post);
		const existingPost = targetPostsBySlug.get(slug);
		if (existingPost && existingPost.filePath !== filePath) {
			throw new Error(
				`Post slug "${slug}" already exists at a different path: ${existingPost.filePath} ${filePath}`,
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

async function syncPosts(
	sourcePosts: SyncPost[],
	targetPostsBySlug: Map<string, SyncPost>,
): Promise<void> {
	let created = 0;
	let updated = 0;
	let unchanged = 0;
	for (const post of sourcePosts) {
		const existingPost = targetPostsBySlug.get(post.frontmatter.slug);
		if (existingPost && !hasPostChanged(post, existingPost)) {
			unchanged++;
			continue;
		}

		const filePath = buildPostFilePath(post);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		const frontmatter = {
			...post.frontmatter,
			updated: existingPost ? buildCurrentDate() : post.frontmatter.published,
		};
		await fs.writeFile(
			filePath,
			matter.stringify(post.content, frontmatter),
			"utf8",
		);
		if (existingPost) {
			updated++;
		} else {
			created++;
		}
	}
	console.log(
		`Created: ${created}, updated: ${updated}, unchanged: ${unchanged}.`,
	);
}

function hasPostChanged(sourcePost: SyncPost, targetPost: SyncPost): boolean {
	return (
		sourcePost.content !== targetPost.content ||
		JSON.stringify(sourcePost.frontmatter) !==
			JSON.stringify(targetPost.frontmatter)
	);
}

function buildCurrentDate(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function buildPostFilePath(post: SyncPost): string {
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
