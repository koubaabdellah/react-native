/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

import type {
  NamedShape,
  NativeModuleAliasMap,
  NativeModuleArrayTypeAnnotation,
  NativeModuleBaseTypeAnnotation,
  NativeModuleFunctionTypeAnnotation,
  NativeModuleParamTypeAnnotation,
  NativeModulePropertyShape,
  NativeModuleSchema,
  Nullable,
} from '../../../CodegenSchema.js';

import type {ParserErrorCapturer, TypeDeclarationMap} from '../../utils';
import type {NativeModuleTypeAnnotation} from '../../../CodegenSchema.js';

const {
  resolveTypeAnnotation,
  getTypes,
  visit,
  isModuleRegistryCall,
} = require('../utils.js');
const {
  unwrapNullable,
  wrapNullable,
  assertGenericTypeAnnotationHasExactlyOneTypeParameter,
} = require('../../parsers-commons');
const {
  emitBoolean,
  emitDouble,
  emitNumber,
  emitInt32,
  emitObject,
  emitPromise,
  emitRootTag,
  emitVoid,
  emitStringish,
  typeAliasResolution,
} = require('../../parsers-primitives');
const {
  MisnamedModuleInterfaceParserError,
  ModuleInterfaceNotFoundParserError,
  MoreThanOneModuleInterfaceParserError,
  UnnamedFunctionParamParserError,
  UnsupportedArrayElementTypeAnnotationParserError,
  UnsupportedGenericParserError,
  UnsupportedTypeAnnotationParserError,
  UnsupportedFunctionParamTypeAnnotationParserError,
  UnsupportedFunctionReturnTypeAnnotationParserError,
  UnsupportedEnumDeclarationParserError,
  UnsupportedUnionTypeAnnotationParserError,
  UnsupportedModulePropertyParserError,
  UnsupportedObjectPropertyTypeAnnotationParserError,
  UnsupportedObjectPropertyValueTypeAnnotationParserError,
  UnusedModuleInterfaceParserError,
  MoreThanOneModuleRegistryCallsParserError,
  UntypedModuleRegistryCallParserError,
  IncorrectModuleRegistryCallTypeParameterParserError,
  IncorrectModuleRegistryCallArityParserError,
  IncorrectModuleRegistryCallArgumentTypeParserError,
} = require('../../errors.js');

const language = 'TypeScript';

function nullGuard<T>(fn: () => T): ?T {
  return fn();
}

function translateArrayTypeAnnotation(
  hasteModuleName: string,
  types: TypeDeclarationMap,
  aliasMap: {...NativeModuleAliasMap},
  cxxOnly: boolean,
  tsArrayType: 'Array' | 'ReadonlyArray',
  tsElementType: $FlowFixMe,
  nullable: $FlowFixMe,
): Nullable<NativeModuleTypeAnnotation> {
  try {
    /**
     * TODO(T72031674): Migrate all our NativeModule specs to not use
     * invalid Array ElementTypes. Then, make the elementType a required
     * parameter.
     */
    const [elementType, isElementTypeNullable] = unwrapNullable(
      translateTypeAnnotation(
        hasteModuleName,
        tsElementType,
        types,
        aliasMap,
        /**
         * TODO(T72031674): Ensure that all ParsingErrors that are thrown
         * while parsing the array element don't get captured and collected.
         * Why? If we detect any parsing error while parsing the element,
         * we should default it to null down the line, here. This is
         * the correct behaviour until we migrate all our NativeModule specs
         * to be parseable.
         */
        nullGuard,
        cxxOnly,
      ),
    );

    if (elementType.type === 'VoidTypeAnnotation') {
      throw new UnsupportedArrayElementTypeAnnotationParserError(
        hasteModuleName,
        tsElementType,
        tsArrayType,
        'void',
        language,
      );
    }

    if (elementType.type === 'PromiseTypeAnnotation') {
      throw new UnsupportedArrayElementTypeAnnotationParserError(
        hasteModuleName,
        tsElementType,
        tsArrayType,
        'Promise',
        language,
      );
    }

    if (elementType.type === 'FunctionTypeAnnotation') {
      throw new UnsupportedArrayElementTypeAnnotationParserError(
        hasteModuleName,
        tsElementType,
        tsArrayType,
        'FunctionTypeAnnotation',
        language,
      );
    }

    const finalTypeAnnotation: NativeModuleArrayTypeAnnotation<
      Nullable<NativeModuleBaseTypeAnnotation>,
    > = {
      type: 'ArrayTypeAnnotation',
      elementType: wrapNullable(isElementTypeNullable, elementType),
    };

    return wrapNullable(nullable, finalTypeAnnotation);
  } catch (ex) {
    return wrapNullable(nullable, {
      type: 'ArrayTypeAnnotation',
    });
  }
}

function translateTypeAnnotation(
  hasteModuleName: string,
  /**
   * TODO(T108222691): Use flow-types for @babel/parser
   */
  typeScriptTypeAnnotation: $FlowFixMe,
  types: TypeDeclarationMap,
  aliasMap: {...NativeModuleAliasMap},
  tryParse: ParserErrorCapturer,
  cxxOnly: boolean,
): Nullable<NativeModuleTypeAnnotation> {
  const {nullable, typeAnnotation, typeAliasResolutionStatus} =
    resolveTypeAnnotation(typeScriptTypeAnnotation, types);

  switch (typeAnnotation.type) {
    case 'TSArrayType': {
      return translateArrayTypeAnnotation(
        hasteModuleName,
        types,
        aliasMap,
        cxxOnly,
        'Array',
        typeAnnotation.elementType,
        nullable,
      );
    }
    case 'TSTypeOperator': {
      if (
        typeAnnotation.operator === 'readonly' &&
        typeAnnotation.typeAnnotation.type === 'TSArrayType'
      ) {
        return translateArrayTypeAnnotation(
          hasteModuleName,
          types,
          aliasMap,
          cxxOnly,
          'ReadonlyArray',
          typeAnnotation.typeAnnotation.elementType,
          nullable,
        );
      } else {
        throw new UnsupportedGenericParserError(
          hasteModuleName,
          typeAnnotation,
          language,
        );
      }
    }
    case 'TSTypeReference': {
      switch (typeAnnotation.typeName.name) {
        case 'RootTag': {
          return emitRootTag(nullable);
        }
        case 'Promise': {
          return emitPromise(
            hasteModuleName,
            typeAnnotation,
            language,
            nullable,
          );
        }
        case 'Array':
        case 'ReadonlyArray': {
          assertGenericTypeAnnotationHasExactlyOneTypeParameter(
            hasteModuleName,
            typeAnnotation,
            language,
          );

          return translateArrayTypeAnnotation(
            hasteModuleName,
            types,
            aliasMap,
            cxxOnly,
            typeAnnotation.type,
            typeAnnotation.typeParameters.params[0],
            nullable,
          );
        }
        case 'Stringish': {
          return emitStringish(nullable);
        }
        case 'Int32': {
          return emitInt32(nullable);
        }
        case 'Double': {
          return emitDouble(nullable);
        }
        case 'Float': {
          return wrapNullable(nullable, {
            type: 'FloatTypeAnnotation',
          });
        }
        case 'UnsafeObject':
        case 'Object': {
          return emitObject(nullable);
        }
        default: {
          const maybeEumDeclaration = types[typeAnnotation.typeName.name];
          if (
            cxxOnly &&
            maybeEumDeclaration &&
            maybeEumDeclaration.type === 'TSEnumDeclaration'
          ) {
            const memberType = maybeEumDeclaration.members[0].initializer
              ? maybeEumDeclaration.members[0].initializer.type
                  .replace('NumericLiteral', 'NumberTypeAnnotation')
                  .replace('StringLiteral', 'StringTypeAnnotation')
              : 'StringTypeAnnotation';
            if (
              memberType === 'NumberTypeAnnotation' ||
              memberType === 'StringTypeAnnotation'
            ) {
              return wrapNullable(nullable, {
                type: 'EnumDeclaration',
                memberType: memberType,
              });
            } else {
              throw new UnsupportedEnumDeclarationParserError(
                hasteModuleName,
                typeAnnotation,
                memberType,
                language,
              );
            }
          }
          throw new UnsupportedGenericParserError(
            hasteModuleName,
            typeAnnotation,
            language,
          );
        }
      }
    }
    case 'TSTypeLiteral': {
      const objectTypeAnnotation = {
        type: 'ObjectTypeAnnotation',
        // $FlowFixMe[missing-type-arg]
        properties: (typeAnnotation.members: Array<$FlowFixMe>)
          .map<?NamedShape<Nullable<NativeModuleBaseTypeAnnotation>>>(
            property => {
              return tryParse(() => {
                if (property.type !== 'TSPropertySignature') {
                  throw new UnsupportedObjectPropertyTypeAnnotationParserError(
                    hasteModuleName,
                    property,
                    property.type,
                    language,
                  );
                }

                const {optional = false, key} = property;

                const [propertyTypeAnnotation, isPropertyNullable] =
                  unwrapNullable(
                    translateTypeAnnotation(
                      hasteModuleName,
                      property.typeAnnotation.typeAnnotation,
                      types,
                      aliasMap,
                      tryParse,
                      cxxOnly,
                    ),
                  );

                if (propertyTypeAnnotation.type === 'FunctionTypeAnnotation') {
                  throw new UnsupportedObjectPropertyValueTypeAnnotationParserError(
                    hasteModuleName,
                    property.typeAnnotation.typeAnnotation,
                    property.key,
                    propertyTypeAnnotation.type,
                    language,
                  );
                }

                if (propertyTypeAnnotation.type === 'VoidTypeAnnotation') {
                  throw new UnsupportedObjectPropertyValueTypeAnnotationParserError(
                    hasteModuleName,
                    property.typeAnnotation.typeAnnotation,
                    property.key,
                    'void',
                    language,
                  );
                }

                if (propertyTypeAnnotation.type === 'PromiseTypeAnnotation') {
                  throw new UnsupportedObjectPropertyValueTypeAnnotationParserError(
                    hasteModuleName,
                    property.typeAnnotation.typeAnnotation,
                    property.key,
                    'Promise',
                    language,
                  );
                }

                return {
                  name: key.name,
                  optional,
                  typeAnnotation: wrapNullable(
                    isPropertyNullable,
                    propertyTypeAnnotation,
                  ),
                };
              });
            },
          )
          .filter(Boolean),
      };

      return typeAliasResolution(
        typeAliasResolutionStatus,
        objectTypeAnnotation,
        aliasMap,
        nullable,
      );
    }
    case 'TSBooleanKeyword': {
      return emitBoolean(nullable);
    }
    case 'TSNumberKeyword': {
      return emitNumber(nullable);
    }
    case 'TSVoidKeyword': {
      return emitVoid(nullable);
    }
    case 'TSStringKeyword': {
      return wrapNullable(nullable, {
        type: 'StringTypeAnnotation',
      });
    }
    case 'TSFunctionType': {
      return wrapNullable(
        nullable,
        translateFunctionTypeAnnotation(
          hasteModuleName,
          typeAnnotation,
          types,
          aliasMap,
          tryParse,
          cxxOnly,
        ),
      );
    }
    case 'TSUnionType': {
      if (cxxOnly) {
        // Remap literal names
        const unionTypes = typeAnnotation.types
          .map(item =>
            item.literal
              ? item.literal.type
                  .replace('NumericLiteral', 'NumberTypeAnnotation')
                  .replace('StringLiteral', 'StringTypeAnnotation')
              : 'ObjectTypeAnnotation',
          )
          .filter((value, index, self) => self.indexOf(value) === index);
        // Only support unionTypes of the same kind
        if (unionTypes.length > 1) {
          throw new UnsupportedUnionTypeAnnotationParserError(
            hasteModuleName,
            typeAnnotation,
            unionTypes,
            language,
          );
        }
        return wrapNullable(nullable, {
          type: 'UnionTypeAnnotation',
          memberType: unionTypes[0],
        });
      }
      // Fallthrough
    }
    case 'TSUnknownKeyword': {
      if (cxxOnly) {
        return wrapNullable(nullable, {
          type: 'MixedTypeAnnotation',
        });
      }
      // Fallthrough
    }
    default: {
      throw new UnsupportedTypeAnnotationParserError(
        hasteModuleName,
        typeAnnotation,
        language,
      );
    }
  }
}

function translateFunctionTypeAnnotation(
  hasteModuleName: string,
  // TODO(T108222691): Use flow-types for @babel/parser
  typescriptFunctionTypeAnnotation: $FlowFixMe,
  types: TypeDeclarationMap,
  aliasMap: {...NativeModuleAliasMap},
  tryParse: ParserErrorCapturer,
  cxxOnly: boolean,
): NativeModuleFunctionTypeAnnotation {
  type Param = NamedShape<Nullable<NativeModuleParamTypeAnnotation>>;
  const params: Array<Param> = [];

  for (const typeScriptParam of (typescriptFunctionTypeAnnotation.parameters: $ReadOnlyArray<$FlowFixMe>)) {
    const parsedParam = tryParse(() => {
      if (typeScriptParam.typeAnnotation == null) {
        throw new UnnamedFunctionParamParserError(
          typeScriptParam,
          hasteModuleName,
          language,
        );
      }

      const paramName = typeScriptParam.name;
      const [paramTypeAnnotation, isParamTypeAnnotationNullable] =
        unwrapNullable(
          translateTypeAnnotation(
            hasteModuleName,
            typeScriptParam.typeAnnotation.typeAnnotation,
            types,
            aliasMap,
            tryParse,
            cxxOnly,
          ),
        );

      if (paramTypeAnnotation.type === 'VoidTypeAnnotation') {
        throw new UnsupportedFunctionParamTypeAnnotationParserError(
          hasteModuleName,
          typeScriptParam.typeAnnotation,
          paramName,
          'void',
          language,
        );
      }

      if (paramTypeAnnotation.type === 'PromiseTypeAnnotation') {
        throw new UnsupportedFunctionParamTypeAnnotationParserError(
          hasteModuleName,
          typeScriptParam.typeAnnotation,
          paramName,
          'Promise',
          language,
        );
      }

      return {
        name: typeScriptParam.name,
        optional: Boolean(typeScriptParam.optional),
        typeAnnotation: wrapNullable(
          isParamTypeAnnotationNullable,
          paramTypeAnnotation,
        ),
      };
    });

    if (parsedParam != null) {
      params.push(parsedParam);
    }
  }

  const [returnTypeAnnotation, isReturnTypeAnnotationNullable] = unwrapNullable(
    translateTypeAnnotation(
      hasteModuleName,
      typescriptFunctionTypeAnnotation.typeAnnotation.typeAnnotation,
      types,
      aliasMap,
      tryParse,
      cxxOnly,
    ),
  );

  if (!cxxOnly && returnTypeAnnotation.type === 'FunctionTypeAnnotation') {
    throw new UnsupportedFunctionReturnTypeAnnotationParserError(
      hasteModuleName,
      typescriptFunctionTypeAnnotation.returnType,
      'FunctionTypeAnnotation',
      language,
    );
  }

  return {
    type: 'FunctionTypeAnnotation',
    returnTypeAnnotation: wrapNullable(
      isReturnTypeAnnotationNullable,
      returnTypeAnnotation,
    ),
    params,
  };
}

function buildPropertySchema(
  hasteModuleName: string,
  // TODO(T108222691): Use flow-types for @babel/parser
  property: $FlowFixMe,
  types: TypeDeclarationMap,
  aliasMap: {...NativeModuleAliasMap},
  tryParse: ParserErrorCapturer,
  cxxOnly: boolean,
): NativeModulePropertyShape {
  let nullable = false;
  let {key} = property;
  let value =
    property.type === 'TSMethodSignature' ? property : property.typeAnnotation;

  const methodName: string = key.name;

  ({nullable, typeAnnotation: value} = resolveTypeAnnotation(value, types));

  if (value.type !== 'TSFunctionType' && value.type !== 'TSMethodSignature') {
    throw new UnsupportedModulePropertyParserError(
      hasteModuleName,
      property.value,
      property.key.name,
      value.type,
      language,
    );
  }

  return {
    name: methodName,
    optional: Boolean(property.optional),
    typeAnnotation: wrapNullable(
      nullable,
      translateFunctionTypeAnnotation(
        hasteModuleName,
        value,
        types,
        aliasMap,
        tryParse,
        cxxOnly,
      ),
    ),
  };
}

function isModuleInterface(node: $FlowFixMe) {
  return (
    node.type === 'TSInterfaceDeclaration' &&
    node.extends.length === 1 &&
    node.extends[0].type === 'TSExpressionWithTypeArguments' &&
    node.extends[0].expression.name === 'TurboModule'
  );
}

function buildModuleSchema(
  hasteModuleName: string,
  /**
   * TODO(T108222691): Use flow-types for @babel/parser
   */
  ast: $FlowFixMe,
  tryParse: ParserErrorCapturer,
): NativeModuleSchema {
  const types = getTypes(ast);
  const moduleSpecs = (Object.values(types): $ReadOnlyArray<$FlowFixMe>).filter(
    isModuleInterface,
  );

  if (moduleSpecs.length === 0) {
    throw new ModuleInterfaceNotFoundParserError(
      hasteModuleName,
      ast,
      language,
    );
  }

  if (moduleSpecs.length > 1) {
    throw new MoreThanOneModuleInterfaceParserError(
      hasteModuleName,
      moduleSpecs,
      moduleSpecs.map(node => node.id.name),
      language,
    );
  }

  const [moduleSpec] = moduleSpecs;

  if (moduleSpec.id.name !== 'Spec') {
    throw new MisnamedModuleInterfaceParserError(
      hasteModuleName,
      moduleSpec.id,
      language,
    );
  }

  // Parse Module Names
  const moduleName = tryParse((): string => {
    const callExpressions = [];
    visit(ast, {
      CallExpression(node) {
        if (isModuleRegistryCall(node)) {
          callExpressions.push(node);
        }
      },
    });

    if (callExpressions.length === 0) {
      throw new UnusedModuleInterfaceParserError(
        hasteModuleName,
        moduleSpec,
        language,
      );
    }

    if (callExpressions.length > 1) {
      throw new MoreThanOneModuleRegistryCallsParserError(
        hasteModuleName,
        callExpressions,
        callExpressions.length,
        language,
      );
    }

    const [callExpression] = callExpressions;
    const {typeParameters} = callExpression;
    const methodName = callExpression.callee.property.name;

    if (callExpression.arguments.length !== 1) {
      throw new IncorrectModuleRegistryCallArityParserError(
        hasteModuleName,
        callExpression,
        methodName,
        callExpression.arguments.length,
        language,
      );
    }

    if (callExpression.arguments[0].type !== 'StringLiteral') {
      const {type} = callExpression.arguments[0];
      throw new IncorrectModuleRegistryCallArgumentTypeParserError(
        hasteModuleName,
        callExpression.arguments[0],
        methodName,
        type,
        language,
      );
    }

    const $moduleName = callExpression.arguments[0].value;

    if (typeParameters == null) {
      throw new UntypedModuleRegistryCallParserError(
        hasteModuleName,
        callExpression,
        methodName,
        $moduleName,
        language,
      );
    }

    if (
      typeParameters.type !== 'TSTypeParameterInstantiation' ||
      typeParameters.params.length !== 1 ||
      typeParameters.params[0].type !== 'TSTypeReference' ||
      typeParameters.params[0].typeName.name !== 'Spec'
    ) {
      throw new IncorrectModuleRegistryCallTypeParameterParserError(
        hasteModuleName,
        typeParameters,
        methodName,
        $moduleName,
        language,
      );
    }

    return $moduleName;
  });

  const moduleNames = moduleName == null ? [] : [moduleName];

  // Some module names use platform suffix to indicate platform-exclusive modules.
  // Eventually this should be made explicit in the Flow type itself.
  // Also check the hasteModuleName for platform suffix.
  // Note: this shape is consistent with ComponentSchema.
  let cxxOnly = false;
  const excludedPlatforms = [];
  const namesToValidate = [...moduleNames, hasteModuleName];
  namesToValidate.forEach(name => {
    if (name.endsWith('Android')) {
      excludedPlatforms.push('iOS');
    } else if (name.endsWith('IOS')) {
      excludedPlatforms.push('android');
    } else if (name.endsWith('Cxx')) {
      cxxOnly = true;
      excludedPlatforms.push('iOS', 'android');
    }
  });

  // $FlowFixMe[missing-type-arg]
  return (moduleSpec.body.body: $ReadOnlyArray<$FlowFixMe>)
    .filter(
      property =>
        property.type === 'TSMethodSignature' ||
        property.type === 'TSPropertySignature',
    )
    .map<?{
      aliasMap: NativeModuleAliasMap,
      propertyShape: NativeModulePropertyShape,
    }>(property => {
      const aliasMap: {...NativeModuleAliasMap} = {};

      return tryParse(() => ({
        aliasMap: aliasMap,
        propertyShape: buildPropertySchema(
          hasteModuleName,
          property,
          types,
          aliasMap,
          tryParse,
          cxxOnly,
        ),
      }));
    })
    .filter(Boolean)
    .reduce(
      (moduleSchema: NativeModuleSchema, {aliasMap, propertyShape}) => {
        return {
          type: 'NativeModule',
          aliases: {...moduleSchema.aliases, ...aliasMap},
          spec: {
            properties: [...moduleSchema.spec.properties, propertyShape],
          },
          moduleNames: moduleSchema.moduleNames,
          excludedPlatforms: moduleSchema.excludedPlatforms,
        };
      },
      {
        type: 'NativeModule',
        aliases: {},
        spec: {properties: []},
        moduleNames: moduleNames,
        excludedPlatforms:
          excludedPlatforms.length !== 0 ? [...excludedPlatforms] : undefined,
      },
    );
}

module.exports = {
  buildModuleSchema,
};
