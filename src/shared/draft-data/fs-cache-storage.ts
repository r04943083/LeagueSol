import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { CacheStorage } from './cache'

/**
 * Filesystem-backed {@link CacheStorage}.
 *
 * A full patch refresh is several hundred requests against a free third-party service, so the
 * result needs to survive process exit — otherwise every run of a tool or a fresh app start pays
 * the whole cost again.
 */
export class FsCacheStorage implements CacheStorage {
  constructor(private readonly _directory: string) {}

  private _path(name: string): string {
    return join(this._directory, name)
  }

  async read(name: string): Promise<string | undefined> {
    try {
      return await readFile(this._path(name), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined
      }
      throw error
    }
  }

  async write(name: string, contents: string): Promise<void> {
    const path = this._path(name)
    await mkdir(dirname(path), { recursive: true })

    // Write to a sibling then rename, which is atomic within a filesystem. An interrupted refresh
    // then leaves either the previous entry or the new one, never a truncated file that happens to
    // parse.
    const temporary = `${path}.${process.pid}.tmp`
    try {
      await writeFile(temporary, contents, 'utf8')
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  }

  async remove(name: string): Promise<void> {
    await rm(this._path(name), { force: true })
  }
}
