import { ClickHouseType } from './types';

type Shape = {
  [key: string]: ClickHouseType;
};

type ClickHouseEngine = 'MergeTree' | 'ReplacingMergeTree';

export class Schema<S extends Shape> {
  constructor(
    private readonly tableName: string,
    private readonly engine: ClickHouseEngine,
    public readonly shape: S
  ) {}

  testCreateTableRender(): string {
    let result = `CREATE TABLE ${this.tableName} (\n`;
    result += Object.entries(this.shape)
      .map(([k, v]) => `  ${k} ${v.render()}`)
      .join(',\n');
    result += '\n)\n';
    result += `ENGINE ${this.engine}`;
    return result;
  }
}

export type Infer<T extends Shape> = {
  [Key in keyof T]: T[Key]['underlying'];
};
