import BoundingSphere from "../../Core/BoundingSphere.js";
import clone from "../../Core/clone.js";
import defined from "../../Core/defined.js";
import Matrix4 from "../../Core/Matrix4.js";
import DrawCommand from "../../Renderer/DrawCommand.js";
import RenderState from "../../Renderer/RenderState.js";
import SceneMode from "../SceneMode.js";
import ShadowMode from "../ShadowMode.js";
import ClassificationModelDrawCommand from "./ClassificationModelDrawCommand.js";
import ModelDrawCommand from "./ModelDrawCommand.js";
import VertexArray from "../../Renderer/VertexArray.js";
import ModelVS from "../../Shaders/Model/ModelVS.js";
import ModelFS from "../../Shaders/Model/ModelFS.js";
import ModelUtility from "./ModelUtility.js";
import DeveloperError from "../../Core/DeveloperError.js";

/**
 * Internal functions to build draw commands for models.
 *
 * (The core of these functions was taken from `buildDrawCommand.js´,
 * as of commit hash 7b93161da1cc03bdc796b204e7aa51fb7acebf04)
 *
 * @private
 */
function ModelDrawCommands() {}

import Geometry from "../../Core/Geometry.js";
import GeometryAttribute from "../../Core/GeometryAttribute.js";
import ComponentDatatype from "../../Core/ComponentDatatype.js";
import PrimitiveType from "../../Core/PrimitiveType.js";
import BufferUsage from "../../Renderer/BufferUsage.js";
/**
 * Builds the {@link ModelDrawCommand} for a {@link ModelRuntimePrimitive}
 * using its render resources. If the model classifies another asset, it
 * builds a {@link ClassificationModelDrawCommand} instead.
 *
 * @param {PrimitiveRenderResources} primitiveRenderResources The render resources for a primitive.
 * @param {FrameState} frameState The frame state for creating GPU resources.
 * @returns {ModelDrawCommand|ClassificationModelDrawCommand} The generated ModelDrawCommand or ClassificationModelDrawCommand.
 *
 * @private
 */
ModelDrawCommands.buildModelDrawCommand = function (
  primitiveRenderResources,
  frameState,
) {
  const shaderBuilder = primitiveRenderResources.shaderBuilder;
  const shaderProgram = createShaderProgram(
    primitiveRenderResources,
    shaderBuilder,
    frameState,
  );

  const command = buildDrawCommandForModel(
    primitiveRenderResources,
    shaderProgram,
    frameState,
  );

  const model = primitiveRenderResources.model;
  const hasClassification = defined(model.classificationType);
  if (hasClassification) {
    return new ClassificationModelDrawCommand({
      primitiveRenderResources: primitiveRenderResources,
      command: command,
    });
  }

  return new ModelDrawCommand({
    primitiveRenderResources: primitiveRenderResources,
    command: command,
  });
};

/**
 * @private
 */
function createShaderProgram(
  primitiveRenderResources,
  shaderBuilder,
  frameState,
) {
  shaderBuilder.addVertexLines(ModelVS);
  shaderBuilder.addFragmentLines(ModelFS);

  const model = primitiveRenderResources.model;
  const shaderProgram = shaderBuilder.buildShaderProgram(frameState.context);
  model._pipelineResources.push(shaderProgram);
  return shaderProgram;
}

/**
 * Builds the {@link DrawCommand} that serves as the basis for either creating
 * a {@link ModelDrawCommand} or a {@link ModelRuntimePrimitive}
 *
 * @param {PrimitiveRenderResources} primitiveRenderResources The render resources for a primitive.
 * @param {ShaderProgram} shaderProgram The shader program
 * @param {FrameState} frameState The frame state for creating GPU resources.
 *
 * @returns {DrawCommand} The generated DrawCommand, to be passed to
 * the ModelDrawCommand or ClassificationModelDrawCommand
 *
 * @private
 */
function buildDrawCommandForModel(
  primitiveRenderResources,
  shaderProgram,
  frameState,
) {
  const indexBuffer = getIndexBuffer(primitiveRenderResources);
  const model = primitiveRenderResources.model;

  const vertexArray = (() => {
    if (
      //JASON TODO -- revisit this after other changes
      model.enableShowGaussianSplatting &&
      (model?.style?.showGaussianSplatting ?? true)
    ) {
      const splatQuadAttrLocations = {
        0: 5,
        1: 1,
        2: 2,
        3: 3,
        4: 4,
        screenQuadPosition: 0,
        splatPosition: 6,
        splatColor: 7,
        // splatScale:8,
        // splatRot:9
        //      splatOpacity: 8,
      };
      const geometry = new Geometry({
        attributes: {
          screenQuadPosition: new GeometryAttribute({
            componentDatatype: ComponentDatatype.FLOAT,
            componentsPerAttribute: 2,
            values: [-2, -2, 2, -2, 2, 2, -2, 2],
            name: "_SCREEN_QUAD_POS",
            variableName: "screenQuadPos",
          }),
          ...primitiveRenderResources.runtimePrimitive.primitive.attributes,
          splatPosition: {
            ...primitiveRenderResources.runtimePrimitive.primitive.attributes.find(
              (a) => a.name === "POSITION",
            ),
            name: "_SPLAT_POSITION",
            variableName: "splatPosition",
          },
          splatColor: {
            ...primitiveRenderResources.runtimePrimitive.primitive.attributes.find(
              (a) => a.name === "COLOR_0",
            ),
            name: "_SPLAT_COLOR",
            variableName: "splatColor",
          },
          // splatScale: {
          //   ...primitiveRenderResources.runtimePrimitive.primitive.attributes.find(
          //     (a) => a.name === "_SCALE",
          //   ),
          //   name: "_SPLAT_SCALE",
          //   variableName: "splatScale"
          // },
          // splatRot: {
          //   ...primitiveRenderResources.runtimePrimitive.primitive.attributes.find(
          //     (a) => a.name === "_ROTATION",
          //   ),
          //   name: "_SPLAT_ROTATION",
          //   variableName: "splatRot"
          // }
          // splatOpacity: {
          //   ...primitiveRenderResources.runtimePrimitive.primitive.attributes.find(
          //     (a) => a.name === "_OPACITY"
          //   ),
          //   name: "_SPLAT_OPACITY",
          //   variableName: "splatOpacity",
          // },
        },
        indices: indexBuffer,
        primitiveType: PrimitiveType.TRIANGLE_STRIP,
      });

      return VertexArray.fromGeometry({
        context: frameState.context,
        geometry: geometry,
        attributeLocations: splatQuadAttrLocations,
        bufferUsage: BufferUsage.STATIC_DRAW,
        interleave: false,
      });
    }

    return new VertexArray({
      context: frameState.context,
      indexBuffer: indexBuffer,
      attributes: primitiveRenderResources.attributes,
    });
  })();

  model._pipelineResources.push(vertexArray);

  const pass = primitiveRenderResources.alphaOptions.pass;
  const sceneGraph = model.sceneGraph;

  const is3D = frameState.mode === SceneMode.SCENE3D;
  let modelMatrix, boundingSphere;

  if (!is3D && !frameState.scene3DOnly && model._projectTo2D) {
    modelMatrix = Matrix4.multiplyTransformation(
      sceneGraph._computedModelMatrix,
      primitiveRenderResources.runtimeNode.computedTransform,
      new Matrix4(),
    );

    const runtimePrimitive = primitiveRenderResources.runtimePrimitive;
    boundingSphere = runtimePrimitive.boundingSphere2D;
  } else {
    const computedModelMatrix = is3D
      ? sceneGraph._computedModelMatrix
      : sceneGraph._computedModelMatrix2D;

    modelMatrix = Matrix4.multiplyTransformation(
      computedModelMatrix,
      primitiveRenderResources.runtimeNode.computedTransform,
      new Matrix4(),
    );

    boundingSphere = BoundingSphere.transform(
      primitiveRenderResources.boundingSphere,
      modelMatrix,
    );
  }

  // Initialize render state with default values
  let renderState = clone(
    RenderState.fromCache(primitiveRenderResources.renderStateOptions),
    true,
  );

  renderState.cull.face = ModelUtility.getCullFace(
    modelMatrix,
    primitiveRenderResources.primitiveType,
  );
  renderState = RenderState.fromCache(renderState);

  const hasClassification = defined(model.classificationType);
  const castShadows = hasClassification
    ? false
    : ShadowMode.castShadows(model.shadows);
  const receiveShadows = hasClassification
    ? false
    : ShadowMode.receiveShadows(model.shadows);
  // Pick IDs are only added to specific draw commands for classification.
  // This behavior is handled by ClassificationModelDrawCommand.
  const pickId = hasClassification
    ? undefined
    : primitiveRenderResources.pickId;

  const command = new DrawCommand({
    boundingVolume: boundingSphere,
    modelMatrix: modelMatrix,
    uniformMap: primitiveRenderResources.uniformMap,
    renderState: renderState,
    vertexArray: vertexArray,
    shaderProgram: shaderProgram,
    cull: model.cull,
    pass: pass,
    count: primitiveRenderResources.count,
    owner: model,
    pickId: pickId,
    pickMetadataAllowed: true,
    instanceCount: primitiveRenderResources.instanceCount,
    primitiveType: primitiveRenderResources.primitiveType,
    debugShowBoundingVolume: model.debugShowBoundingVolume,
    castShadows: castShadows,
    receiveShadows: receiveShadows,
  });
  return command;
}

/**
 * @private
 */
function getIndexBuffer(primitiveRenderResources) {
  const wireframeIndexBuffer = primitiveRenderResources.wireframeIndexBuffer;
  if (defined(wireframeIndexBuffer)) {
    return wireframeIndexBuffer;
  }

  const indices = primitiveRenderResources.indices;
  if (!defined(indices)) {
    return undefined;
  }

  //>>includeStart('debug', pragmas.debug);
  if (!defined(indices.buffer)) {
    throw new DeveloperError("Indices must be provided as a Buffer");
  }
  //>>includeEnd('debug');

  return indices.buffer;
}

export default ModelDrawCommands;
