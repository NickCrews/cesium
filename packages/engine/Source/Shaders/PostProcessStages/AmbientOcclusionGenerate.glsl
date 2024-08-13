uniform sampler2D randomTexture;
uniform sampler2D depthTexture;
uniform float intensity;
uniform float bias;
uniform float lengthCap;
uniform float stepSize;
uniform float frustumLength;

in vec2 v_textureCoordinates;

vec4 clipToEye(vec2 uv, float depth)
{
    vec2 xy = vec2((uv.x * 2.0 - 1.0), ((1.0 - uv.y) * 2.0 - 1.0));
    vec4 posEC = czm_inverseProjection * vec4(xy, depth, 1.0);
    posEC = posEC / posEC.w;
    return posEC;
}

vec4 screenToEye(vec2 screenCoordinate)
{
    float depth = czm_readDepth(depthTexture, screenCoordinate);
    return clipToEye(screenCoordinate, depth);
}

// Reconstruct surface normal, avoiding edges
vec3 getNormalXEdge(vec3 posInCamera, vec2 pixelSize)
{
    vec4 posInCameraUp = screenToEye(v_textureCoordinates - vec2(0.0, pixelSize.y));
    vec4 posInCameraDown = screenToEye(v_textureCoordinates + vec2(0.0, pixelSize.y));
    vec4 posInCameraLeft = screenToEye(v_textureCoordinates - vec2(pixelSize.x, 0.0));
    vec4 posInCameraRight = screenToEye(v_textureCoordinates + vec2(pixelSize.x, 0.0));

    vec3 up = posInCamera - posInCameraUp.xyz;
    vec3 down = posInCameraDown.xyz - posInCamera;
    vec3 left = posInCamera - posInCameraLeft.xyz;
    vec3 right = posInCameraRight.xyz - posInCamera;

    vec3 DX = length(left) < length(right) ? left : right;
    vec3 DY = length(up) < length(down) ? up : down;

    return normalize(cross(DY, DX));
}

void main(void)
{
    vec4 posInCamera = screenToEye(v_textureCoordinates);

    if (posInCamera.z > frustumLength)
    {
        out_FragColor = vec4(1.0);
        return;
    }

    vec2 pixelSize = czm_pixelRatio / czm_viewport.zw;
    vec3 normalInCamera = getNormalXEdge(posInCamera.xyz, pixelSize);
    // Sampling direction rotation (different for each pixel)
    float randomVal = texture(randomTexture, v_textureCoordinates / pixelSize / 255.0).x;

    float ao = 0.0;

    // Loop over sampling directions
    for (int i = 0; i < 4; i++)
    {
        // TODO: each direction is just mat2(0.0, 1.0, -1.0, 0.0) * prevDirection. Could skip 3/4 of the sin/cos
        float sampleAngle = czm_piOverTwo * (float(i) + randomVal);
        vec2 sampleDirection = vec2(cos(sampleAngle), sin(sampleAngle));

        float localAO = 0.0;
        float localStepSize = stepSize;

        for (int j = 0; j < 6; j++)
        {
            // Step along sampling direction, away from output pixel
            vec2 newCoords = v_textureCoordinates + sampleDirection * localStepSize * pixelSize;

            // Exit if we stepped off the screen
            if (newCoords.x > 1.0 || newCoords.y > 1.0 || newCoords.x < 0.0 || newCoords.y < 0.0)
            {
                break;
            }

            vec4 stepPosInCamera = screenToEye(newCoords);
            vec3 diffVec = stepPosInCamera.xyz - posInCamera.xyz;
            float len = length(diffVec);

            if (len > lengthCap)
            {
                break;
            }

            float dotVal = clamp(dot(normalInCamera, normalize(diffVec)), 0.0, 1.0);
            float weight = len / lengthCap;
            weight = 1.0 - weight * weight;

            if (dotVal < bias)
            {
                dotVal = 0.0;
            }

            localAO = max(localAO, dotVal * weight);
            localStepSize += stepSize;
        }
        ao += localAO;
    }

    ao /= 4.0;
    ao = 1.0 - clamp(ao, 0.0, 1.0);
    ao = pow(ao, intensity);
    out_FragColor = vec4(vec3(ao), 1.0);
}
