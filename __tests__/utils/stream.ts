import Path from 'path'
import Fs from 'fs'

export function createFileStream(filename: string) {
  const path = Path.resolve(__dirname, '../resources/' + filename)
  return Fs.createReadStream(path)
}
