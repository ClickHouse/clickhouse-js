/* eslint-disable @typescript-eslint/ban-types */

/*
TODO:
  JSON (experimental)
  AggregateFunction
  SimpleAggregateFunction
  Nested
  Special Data Types
  Geo (experimental)
  Multi-word Types
  Better Date(Time) parsing/handling, including timezones
  Tuple
    - Named tuple
  Decimal (without precision loss)
    - see https://github.com/ClickHouse/ClickHouse/issues/21875
    - currently disabled due to precision loss when using JS numbers in runtime
*/

type Int = UInt8 | UInt16 | UInt32 | UInt64 | UInt128 | UInt256
type UInt = Int8 | Int16 | Int32 | Int64 | Int128 | Int256
type Float = Float32 | Float64
export type Type =
  | Int
  | UInt
  | Float
  | Bool
  | String
  | FixedString
  | Array<any>
  | Nullable<any>
  | Map<any, any>
  // | Decimal
  | UUID
  | Enum<any>
  | LowCardinality<any>
  | Date
  | Date32
  | DateTime
  | DateTime64
  | IPv4
  | IPv6

export interface UInt8 {
  underlying: number
  type: 'UInt8'
}
export const UInt8 = {
  type: 'UInt8',
  toString(): string {
    return 'UInt8'
  },
} as UInt8
export interface UInt16 {
  type: 'UInt16'
  underlying: number
}
export const UInt16 = {
  type: 'UInt16',
  toString(): string {
    return 'UInt16'
  },
} as UInt16
export interface UInt32 {
  type: 'UInt32'
  underlying: number
}
export const UInt32 = {
  type: 'UInt32',
  toString(): string {
    return 'UInt32'
  },
} as UInt32
export interface UInt64 {
  underlying: string
  type: 'UInt64'
}
/**
 * Uses string as the inferred type, since its max value
 * is greater than Number.MAX_SAFE_INTEGER
 *
 * Max UInt64:               18446744073709551615
 * Number.MAX_SAFE_INTEGER:  9007199254740991
 *
 * It can be cast to number
 * by disabling `output_format_json_quote_64bit_integers` CH setting
 */
export const UInt64 = {
  type: 'UInt64',
  toString(): string {
    return 'UInt64'
  },
} as UInt64
export interface UInt128 {
  type: 'UInt128'
  underlying: string
}
/**
 * Uses string as the inferred type, since its max value
 * is greater than Number.MAX_SAFE_INTEGER
 */
export const UInt128 = {
  type: 'UInt128',
  toString(): string {
    return 'UInt128'
  },
} as UInt128
export interface UInt256 {
  type: 'UInt256'
  underlying: string
}
/**
 * Uses string as the inferred type, since its max value
 * is greater than Number.MAX_SAFE_INTEGER
 */
export const UInt256 = {
  type: 'UInt256',
  toString(): string {
    return 'UInt256'
  },
} as UInt256

export interface Int8 {
  underlying: number
  type: 'Int8'
}
export const Int8 = {
  type: 'Int8',
  toString(): string {
    return 'Int8'
  },
} as Int8
export interface Int16 {
  type: 'Int16'
  underlying: number
}
export const Int16 = {
  type: 'Int16',
  toString(): string {
    return 'Int16'
  },
} as Int16
export interface Int32 {
  type: 'Int32'
  underlying: number
}
export const Int32 = {
  type: 'Int32',
  toString(): string {
    return 'Int32'
  },
} as Int32

export interface Int64 {
  underlying: string
  type: 'Int64'
}
/**
 * Uses string as the inferred type, since its max value
 * is greater than Number.MAX_SAFE_INTEGER
 *
 * Max Int64:                9223372036854775807
 * Number.MAX_SAFE_INTEGER:  9007199254740991
 *
 * It could be cast to number
 * by disabling `output_format_json_quote_64bit_integers` CH setting
 */
export const Int64 = {
  type: 'Int64',
  toString(): string {
    return 'Int64'
  },
} as Int64
export interface Int128 {
  type: 'Int128'
  underlying: string
}
/**
 * Uses string as the inferred type, since its max value
 * is greater than Number.MAX_SAFE_INTEGER
 */
export const Int128 = {
  type: 'Int128',
  toString(): string {
    return 'Int128'
  },
} as Int128
export interface Int256 {
  type: 'Int256'
  underlying: string
}
/**
 * Uses string as the inferred type, since its max value
 * is greater than Number.MAX_SAFE_INTEGER
 */
export const Int256 = {
  type: 'Int256',
  toString(): string {
    return 'Int256'
  },
} as Int256

export interface Float32 {
  type: 'Float32'
  underlying: number
}
export const Float32 = {
  type: 'Float32',
  toString(): string {
    return 'Float32'
  },
} as Float32
export interface Float64 {
  type: 'Float64'
  underlying: number
}
export const Float64 = {
  type: 'Float64',
  toString(): string {
    return 'Float64'
  },
} as Float64

export interface Decimal {
  type: 'Decimal'
  underlying: number
}
export const Decimal = ({
  precision,
  scale,
}: {
  precision: number
  scale: number
}) =>
  ({
    type: 'Decimal',
    toString(): string {
      if (scale < 0) {
        throw new Error(
          `Invalid Decimal scale. Valid range: [ 0 : P ], got ${scale}`
        )
      }
      if (precision > 0 && precision < 10) {
        return `Decimal32(${scale})`
      }
      if (precision > 10 && precision < 19) {
        return `Decimal64(${scale})`
      }
      if (precision > 19 && precision < 39) {
        return `Decimal128(${scale})`
      }
      if (precision > 19 && precision < 39) {
        return `Decimal128(${scale})`
      }
      if (precision > 39 && precision < 77) {
        return `Decimal256(${scale})`
      }
      throw Error(
        `Unsupported Decimal precision. Valid range: [ 1 : 18 ], got ${precision}`
      )
    },
  } as Decimal)

export interface Bool {
  type: 'Bool'
  underlying: boolean
}
export const Bool = {
  type: 'Bool',
  toString(): string {
    return 'Bool'
  },
} as Bool

export interface String {
  type: 'String'
  underlying: string
}
export const String = {
  type: 'String',
  toString(): string {
    return 'String'
  },
} as String

export interface FixedString {
  type: 'FixedString'
  underlying: string
}
export const FixedString = (bytes: number) =>
  ({
    type: 'FixedString',
    toString(): string {
      return `FixedString(${bytes})`
    },
  } as FixedString)

export interface UUID {
  type: 'UUID'
  underlying: string
}
export const UUID = {
  type: 'UUID',
  toString(): string {
    return 'UUID'
  },
} as UUID

type StandardEnum<T> = {
  [id: string]: T | string
  [n: number]: string
}

export interface Enum<T extends StandardEnum<unknown>> {
  type: 'Enum'
  underlying: keyof T
}
// https://github.com/microsoft/TypeScript/issues/30611#issuecomment-479087883
// Currently limited to only string enums
export function Enum<T extends StandardEnum<unknown>>(enumVariable: T) {
  return {
    type: 'Enum',
    toString(): string {
      return `Enum(${Object.keys(enumVariable)
        .map((k) => `'${k}'`)
        .join(', ')})`
    },
  } as Enum<T>
}

type LowCardinalityDataType =
  | String
  | FixedString
  | UInt
  | Int
  | Float
  | Date
  | DateTime
export interface LowCardinality<T extends LowCardinalityDataType> {
  type: 'LowCardinality'
  underlying: T['underlying']
}
export const LowCardinality = <T extends LowCardinalityDataType>(type: T) =>
  ({
    type: 'LowCardinality',
    toString(): string {
      return `LowCardinality(${type})`
    },
  } as LowCardinality<T>)

export interface Array<T extends Type> {
  type: 'Array'
  underlying: globalThis.Array<T['underlying']>
}
export const Array = <T extends Type>(inner: T) =>
  ({
    type: 'Array',
    toString(): string {
      return `Array(${inner.toString()})`
    },
  } as Array<T>)

type NullableType =
  | Int
  | UInt
  | Float
  | Bool
  | String
  | FixedString
  | UUID
  | Decimal
  | Enum<any>
  | Date
  | DateTime
  | Date32
  | IPv4
  | IPv6
export interface Nullable<T extends NullableType> {
  type: 'Nullable'
  underlying: T['underlying'] | null
}
export const Nullable = <T extends NullableType>(inner: T) =>
  ({
    type: 'Nullable',
    toString(): string {
      return `Nullable(${inner.toString()})`
    },
  } as Nullable<T>)

type MapKey =
  | String
  | Int
  | UInt
  | FixedString
  | UUID
  | Enum<any>
  | Date
  | DateTime
  | Date32
export interface Map<K extends MapKey, V extends Type> {
  type: 'Map'
  underlying: Record<K['underlying'], V['underlying']>
}
export const Map = <K extends MapKey, V extends Type>(k: K, v: V) =>
  ({
    type: 'Map',
    toString(): string {
      return `Map(${k.toString()}, ${v.toString()})`
    },
  } as Map<K, V>)

export interface Date {
  type: 'Date'
  underlying: string // '1970-01-01' to '2149-06-06'
}
export const Date = {
  type: 'Date',
  toString(): string {
    return 'Date'
  },
} as Date

export interface Date32 {
  type: 'Date32'
  underlying: string // '1900-01-01' to '2299-12-31'
}
export const Date32 = {
  type: 'Date32',
  toString(): string {
    return 'Date32'
  },
} as Date32

export interface DateTime {
  type: 'DateTime'
  underlying: string // '1970-01-01 00:00:00' to '2106-02-07 06:28:15'
}
export const DateTime = (timezone?: string) =>
  ({
    type: 'DateTime',
    toString(): string {
      const tz = timezone ? ` (${timezone})` : ''
      return `DateTime${tz}`
    },
  } as DateTime)

export interface DateTime64 {
  type: 'DateTime64'
  underlying: string // '1900-01-01 00:00:00' to '2299-12-31 23:59:59.99999999'
}
export const DateTime64 = (precision: number, timezone?: string) =>
  ({
    type: 'DateTime64',
    toString(): string {
      const tz = timezone ? `, ${timezone}` : ''
      return `DateTime64(${precision}${tz})`
    },
  } as DateTime64)

export interface IPv4 {
  type: 'IPv4'
  underlying: string // 255.255.255.255
}
export const IPv4 = {
  type: 'IPv4',
  toString(): string {
    return 'IPv4'
  },
} as IPv4

export interface IPv6 {
  type: 'IPv6'
  underlying: string // 2001:db8:85a3::8a2e:370:7334
}
export const IPv6 = {
  type: 'IPv6',
  toString(): string {
    return 'IPv6'
  },
} as IPv6

// TODO: Tuple is disabled for now. Figure out type derivation in this case

// export interface Tuple<T extends Type> = {
//   type: 'Tuple'
//   // underlying: globalThis.Array<T['underlying']>
// }
// export const Tuple = <T extends Type>(...inner: T[]) =>
//   ({
//     type: 'Tuple',
//     toString(): string {
//       return `Tuple(${inner.join(', ')})`
//     },
//   } as Tuple<T>)
