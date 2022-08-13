import { Brand } from 'utility-types';

interface Render {
  render(): string;
}

export type UInt8 = Brand<number, 'UInt8'> & {
  underlying: number;
} & Render;
export const UInt8 = {
  render(): string {
    return 'UInt8';
  },
} as UInt8;

export type Str = Brand<string, 'String'> & {
  underlying: string;
} & Render;
export const Str = {
  render(): string {
    return 'String';
  },
} as Str & Render;

export type Bool = Brand<string, 'Bool'> & {
  underlying: boolean;
} & Render;
export const Bool = {
  render(): string {
    return 'Bool';
  },
} as Bool;

export type Arr<T extends ClickHousePrimitiveType> = Brand<
  Array<T['underlying']>,
  'Array'
> & {
  underlying: Array<T['underlying']>;
} & Render;
export const Arr = <T extends ClickHousePrimitiveType>(inner: T & Render) =>
  ({
    render(): string {
      return `Array(${inner.render()})`;
    },
  } as Arr<T>);

export type Nullable<T extends ClickHousePrimitiveType> = Brand<
  T['underlying'] | null,
  'Nullable'
> & {
  underlying: T['underlying'] | null;
} & Render;
export const Nullable = <T extends ClickHousePrimitiveType>(
  inner: T & Render
) =>
  ({
    render(): string {
      return `Nullable(${inner.render()})`;
    },
  } as Nullable<T>);

export type ClickHousePrimitiveType = Bool | Str | UInt8;

export type ClickHouseType =
  | ClickHousePrimitiveType
  | Arr<ClickHousePrimitiveType>
  | Nullable<ClickHousePrimitiveType>;
