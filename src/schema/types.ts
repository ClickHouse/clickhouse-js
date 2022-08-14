/* eslint-disable @typescript-eslint/ban-types */
import { Brand } from 'utility-types';

// TODO: rest of the types

export type Primitive = Bool | String | UInt8;
export type Type = Primitive | Array<any> | Nullable<Primitive> | Map<any, any>;

export type UInt8 = Brand<number, 'UInt8'> & {
  underlying: number;
};
export const UInt8 = {
  toString(): string {
    return 'UInt8';
  },
} as UInt8;

export type String = Brand<string, 'String'> & {
  underlying: string;
};
export const String = {
  toString(): string {
    return 'String';
  },
} as String;

export type Bool = Brand<string, 'Bool'> & {
  underlying: boolean;
};
export const Bool = {
  toString(): string {
    return 'Bool';
  },
} as Bool;

export type Array<T extends Primitive> = Brand<
  globalThis.Array<T['underlying']>,
  'Array'
> & {
  underlying: globalThis.Array<T['underlying']>;
};
export const Array = <T extends Primitive>(inner: T) =>
  ({
    toString(): string {
      return `Array(${inner.toString()})`;
    },
  } as Array<T>);

export type Nullable<T extends Primitive> = Brand<
  T['underlying'] | null,
  'Nullable'
> & {
  underlying: T['underlying'] | null;
};
export const Nullable = <T extends Primitive>(inner: T) =>
  ({
    toString(): string {
      return `Nullable(${inner.toString()})`;
    },
  } as Nullable<T>);

export type Map<K extends Primitive, V extends Type> = Brand<
  globalThis.Map<K['underlying'], V['underlying']>,
  'Map'
> & {
  underlying: globalThis.Map<K['underlying'], V['underlying']>;
};
export const Map = <K extends Primitive, V extends Type>(k: K, v: V) =>
  ({
    toString(): string {
      return `Map(${k.toString()}, ${v.toString()})`;
    },
  } as Map<K, V>);
