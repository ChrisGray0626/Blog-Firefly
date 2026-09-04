import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { siteConfig } from "@/config";
import { POSTS_DIR_PATH } from "./constants";
import { assertPostSlugAvailable, createPostSlug } from "./post-slug";

async function main(): Promise<void> {
	const [category, titleArgument] = process.argv.slice(2);
	if (!category) {
		throw new Error("Usage: pnpm new-post <category> [title]");
	}

	const published = buildPublishedDate();
	const title = titleArgument || published;
	assertValidPostPathSegment(category, "category");
	assertValidPostTitle(title);

	const filePath = buildPostFilePath(category, title);
	const slug = createPostSlug(title, siteConfig.post.slug);

	await assertPostSlugAvailable(slug);
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(
		filePath,
		buildPostContent(category, title, published, slug),
		{
			encoding: "utf8",
			flag: "wx",
		},
	);

	console.log(`Post ${filePath} created`);
}

function assertValidPostTitle(title: string): void {
	assertValidPostPathSegment(title, "title");
	if (/\.(md|mdx)$/i.test(title)) {
		throw new Error("Post title must not include a .md or .mdx extension.");
	}
}

function assertValidPostPathSegment(value: string, name: string): void {
	if (
		value !== value.trim() ||
		value === "." ||
		value === ".." ||
		/[\0/\\]/.test(value)
	) {
		throw new Error(`Invalid post ${name}: ${value}`);
	}
}

function buildPostFilePath(category: string, title: string): string {
	return path.join(POSTS_DIR_PATH, category, `${title}.md`);
}

function buildPostContent(
	category: string,
	title: string,
	published: string,
	slug: string,
): string {
	return matter.stringify("", {
		title,
		published,
		description: "",
		image: "",
		tags: [],
		category,
		lang: "",
		slug,
	});
}

function buildPublishedDate(): string {
	const today = new Date();
	const year = today.getFullYear();
	const month = String(today.getMonth() + 1).padStart(2, "0");
	const day = String(today.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
