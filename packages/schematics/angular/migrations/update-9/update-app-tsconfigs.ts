/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { JsonAstObject } from '@angular-devkit/core';
import { Rule, Tree, UpdateRecorder } from '@angular-devkit/schematics';
import {
  findPropertyInAstObject,
  insertPropertyInAstObjectInOrder,
  removePropertyInAstObject,
} from '../../utility/json-utils';
import { Builders } from '../../utility/workspace-models';
import { getAllOptions, getTargets, getWorkspace, readJsonFileAsAstObject } from './utils';


/**
 * Update the tsconfig files for applications
 * - Removes enableIvy: true
 * - Sets stricter file inclusions
 */
export function updateApplicationTsConfigs(): Rule {
  return (tree: Tree) => {
    const workspace = getWorkspace(tree);

    for (const { target } of getTargets(workspace, 'build', Builders.Browser)) {
      updateTsConfig(tree, target, Builders.Browser);
    }

    for (const { target } of getTargets(workspace, 'server', Builders.Server)) {
      updateTsConfig(tree, target, Builders.Server);
    }

    for (const { target } of getTargets(workspace, 'test', Builders.Karma)) {
      updateTsConfig(tree, target, Builders.Karma);
    }

    return tree;
  };
}

function updateTsConfig(tree: Tree, builderConfig: JsonAstObject, builderName: Builders) {
  const options = getAllOptions(builderConfig);
  for (const option of options) {
    let recorder: UpdateRecorder;
    const tsConfigOption = findPropertyInAstObject(option, 'tsConfig');

    if (!tsConfigOption || tsConfigOption.kind !== 'string') {
      continue;
    }

    const tsConfigPath = tsConfigOption.value;
    let tsConfigAst = readJsonFileAsAstObject(tree, tsConfigPath);
    if (!tsConfigAst) {
      continue;
    }

    // Remove 'enableIvy: true' since this is the default in version 9.
    const angularCompilerOptions = findPropertyInAstObject(tsConfigAst, 'angularCompilerOptions');
    if (angularCompilerOptions && angularCompilerOptions.kind === 'object') {
      const enableIvy = findPropertyInAstObject(angularCompilerOptions, 'enableIvy');
      if (enableIvy && enableIvy.kind === 'true') {
        recorder = tree.beginUpdate(tsConfigPath);
        if (angularCompilerOptions.properties.length === 1) {
          // remove entire 'angularCompilerOptions'
          removePropertyInAstObject(recorder, tsConfigAst, 'angularCompilerOptions');
        } else {
          removePropertyInAstObject(recorder, angularCompilerOptions, 'enableIvy');
        }
        tree.commitUpdate(recorder);
      }
    }

    // Add stricter file inclusions to avoid unused file warning during compilation
    const rootInSrc = tsConfigPath.includes('src/');
    const rootSrc = rootInSrc ? '' : 'src/';
    if (builderName !== Builders.Karma) {
      // Note: we need to re-read the tsconfig after very commit because
      // otherwise the updates will be out of sync since we are ammending the same node.
      tsConfigAst = readJsonFileAsAstObject(tree, tsConfigPath);
      const files = findPropertyInAstObject(tsConfigAst, 'files');
      const include = findPropertyInAstObject(tsConfigAst, 'include');

      recorder = tree.beginUpdate(tsConfigPath);
      if (include && include.kind === 'array') {
        const tsInclude = include.elements.find(({ value }) => typeof value === 'string' && value.endsWith('**/*.ts'));
        if (tsInclude) {
          const { start, end } = tsInclude;
          recorder.remove(start.offset, end.offset - start.offset);
          // Replace ts includes with d.ts
          recorder.insertLeft(start.offset, tsInclude.text.replace('.ts', '.d.ts'));
        }
      } else {
        insertPropertyInAstObjectInOrder(recorder, tsConfigAst, 'include', [`${rootSrc}**/*.d.ts`], 2);
      }

      tree.commitUpdate(recorder);

      if (!files) {
        tsConfigAst = readJsonFileAsAstObject(tree, tsConfigPath);
        recorder = tree.beginUpdate(tsConfigPath);

        const files = builderName === Builders.Server
          ? [`${rootSrc}main.server.ts`]
          : [`${rootSrc}main.ts`, `${rootSrc}polyfills.ts`];
        insertPropertyInAstObjectInOrder(recorder, tsConfigAst, 'files', files, 2);
        removePropertyInAstObject(recorder, tsConfigAst, 'exclude');
        tree.commitUpdate(recorder);
      }
    }
  }
}
