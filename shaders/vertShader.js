
const vertexShaderSource = /*glsl*/`#version 300 es

precision mediump float;

uniform vec2 uRes;

void main(){
    vec2 positions[4] = vec2[](
        vec2(-1.0, -1.0), 
        vec2( 1.0, -1.0),
        vec2(-1.0,  1.0),
        vec2( 1.0,  1.0)
    );

    gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
}
`;