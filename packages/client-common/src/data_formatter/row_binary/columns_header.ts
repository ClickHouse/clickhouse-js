import type { DecimalParams, ParsedColumnType } from './columns_parser'
import { RowBinaryColumnTypesParser } from './columns_parser'
import { ClickHouseRowBinaryError } from './errors'
import type { DecodeResult } from './read_bytes'
import { readBytesAsUnsignedLEB128 } from './read_bytes'
import {
  RowBinarySimpleDecoders,
  RowBinaryTypesDecoder,
  SimpleTypeDecoder,
  TypeDecoder,
} from './types'

export type DecodedColumns = DecodeResult<{
  names: string[]
  types: ParsedColumnType[]
  decoders: SimpleTypeDecoder[]
}>

/** @throws ClickHouseRowBinaryError */
export class RowBinaryColumnsHeader {
  static decode(src: Uint8Array): DecodedColumns {
    const res = readBytesAsUnsignedLEB128(src, 0)
    if (res === null) {
      throw ClickHouseRowBinaryError.headerDecodingError(
        'Not enough data to decode number of columns',
        {}
      )
    }
    const numColumns = res[0]
    let nextLoc = res[1]
    const names = new Array<string>(numColumns)
    const types = new Array<ParsedColumnType>(numColumns)
    const decoders = new Array<SimpleTypeDecoder>(numColumns)
    for (let i = 0; i < numColumns; i++) {
      const res = RowBinaryTypesDecoder.string(src, nextLoc)
      if (res === null) {
        throw ClickHouseRowBinaryError.headerDecodingError(
          `Not enough data to decode column name`,
          { i, names, numColumns, nextLoc }
        )
      }
      nextLoc = res[1]
      names[i] = res[0]
    }
    for (let i = 0; i < numColumns; i++) {
      const res = RowBinaryTypesDecoder.string(src, nextLoc)
      if (res === null) {
        throw ClickHouseRowBinaryError.headerDecodingError(
          `Not enough data to decode column type`,
          { i, names, types, numColumns, nextLoc }
        )
      }
      nextLoc = res[1]
      const col = RowBinaryColumnTypesParser.parseColumnType(res[0])
      types[i] = col
      let valueDecoder: TypeDecoder
      switch (col.type) {
        case 'Simple':
          decoders[i] = RowBinarySimpleDecoders[col.columnType]
          break
        case 'Decimal':
          decoders[i] = getDecimalDecoder(col.params)
          break
        case 'Array':
          if (col.valueType === 'Decimal') {
            valueDecoder = getDecimalDecoder(col.decimalParams)
          } else {
            valueDecoder = RowBinarySimpleDecoders[col.valueType]
          }
          decoders[i] = RowBinaryTypesDecoder.array(
            col.valueNullable
              ? RowBinaryTypesDecoder.nullable(valueDecoder)
              : valueDecoder,
            col.dimensions
          )
          break
        case 'Nullable':
          if (col.valueType === 'Decimal') {
            valueDecoder = getDecimalDecoder(col.decimalParams)
          } else {
            valueDecoder = RowBinarySimpleDecoders[col.valueType]
          }
          decoders[i] = RowBinaryTypesDecoder.nullable(valueDecoder)
          break
        default:
          throw ClickHouseRowBinaryError.headerDecodingError(
            'Unsupported column type',
            { col }
          )
      }
    }
    // console.log(`Decoded columns:`, names, types)
    return [{ names, types, decoders }, nextLoc]
  }
}

function getDecimalDecoder(decimalParams: DecimalParams): SimpleTypeDecoder {
  const intSize = decimalParams.intSize
  if (intSize === 32) {
    return RowBinaryTypesDecoder.decimal32(decimalParams.scale)
  }
  if (intSize === 64) {
    return RowBinaryTypesDecoder.decimal64(decimalParams.scale)
  }
  // for tests only (128 and 256 support is there)
  throw new Error(`Unsupported Decimal size: ${intSize}`)
}
//
// export class RowBinaryColumnsHeaderDataView {
//   static decode(src: Uint8Array): DecodeResult<{
//     names: string[]
//     types: ParsedColumnType[]
//     decoders: SimpleTypeDecoderDataView[]
//   }>
//   {
//     const res = readBytesAsUnsignedLEB128(src, 0)
//     if (res === null) {
//       throw ClickHouseRowBinaryError.headerDecodingError(
//         'Not enough data to decode number of columns',
//         {}
//       )
//     }
//     const numColumns = res[0]
//     let nextLoc = res[1]
//     const names = new Array<string>(numColumns)
//     const types = new Array<ParsedColumnType>(numColumns)
//     const decoders = new Array<SimpleTypeDecoderDataView>(numColumns)
//     for (let i = 0; i < numColumns; i++) {
//       const res = RowBinaryTypesDecoder.string(src, nextLoc)
//       if (res === null) {
//         throw ClickHouseRowBinaryError.headerDecodingError(
//           `Not enough data to decode column name`,
//           { i, names, numColumns, nextLoc }
//         )
//       }
//       nextLoc = res[1]
//       names[i] = res[0]
//     }
//     for (let i = 0; i < numColumns; i++) {
//       const res = RowBinaryTypesDecoder.string(src, nextLoc)
//       if (res === null) {
//         throw ClickHouseRowBinaryError.headerDecodingError(
//           `Not enough data to decode column type`,
//           { i, names, types, numColumns, nextLoc }
//         )
//       }
//       nextLoc = res[1]
//       const col = RowBinaryColumnTypesParser.parseColumnType(res[0])
//       types[i] = col
//       let valueDecoder: SimpleTypeDecoderDataView
//       switch (col.type) {
//         case 'Simple':
//           decoders[i] =
//             RowBinarySimpleDecodersDataView[
//               col.columnType as keyof RowBinaryTypesDecoderDataView
//             ]
//           break
//         case 'Decimal':
//           decoders[i] = RowBinaryTypesDecoderDataView.decimal(
//             col.params.precision,
//             col.params.scale
//           )
//           break
//         case 'Array':
//           // if (col.valueType === 'Decimal') {
//           //   valueDecoder = RowBinaryTypesDecoder.decimal(
//           //     col.decimalParams.precision,
//           //     col.decimalParams.scale
//           //   )
//           // } else {
//           //   valueDecoder =
//           //     RowBinarySimpleDecodersDataView[
//           //       col.valueType as keyof RowBinaryTypesDecoderDataView
//           //     ]
//           // }
//           // decoders[i] = RowBinaryTypesDecoderDataView.array(
//           //   col.valueNullable
//           //     ? RowBinaryTypesDecoder.nullable(valueDecoder)
//           //     : valueDecoder,
//           //   col.dimensions
//           // )
//           throw new Error('Array type is not supported yet')
//         case 'Nullable':
//           if (col.valueType === 'Decimal') {
//             valueDecoder = RowBinaryTypesDecoderDataView.decimal(
//               col.decimalParams.precision,
//               col.decimalParams.scale
//             )
//           } else {
//             valueDecoder =
//               RowBinarySimpleDecodersDataView[
//                 col.valueType as keyof RowBinaryTypesDecoderDataView
//               ]
//           }
//           decoders[i] = RowBinaryTypesDecoderDataView.nullable(valueDecoder)
//           break
//         default:
//           throw ClickHouseRowBinaryError.headerDecodingError(
//             'Unsupported column type',
//             { col }
//           )
//       }
//     }
//     // console.log(`Decoded columns:`, names, types)
//     return [{ names, types, decoders }, nextLoc]
//   }
// }
