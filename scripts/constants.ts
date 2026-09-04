import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJ_ROOT_PATH: string = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

export const POSTS_DIR_PATH: string = path.join(
	PROJ_ROOT_PATH,
	"src/content/posts",
);
export const ENV_FILE_PATH: string = path.join(PROJ_ROOT_PATH, ".env");
