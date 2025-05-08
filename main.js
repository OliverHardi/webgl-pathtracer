// the main file

const MODEL_NAME = 'default';
const HDRI_NAME = 'goegap';

let SCALE_FACTOR = 0.5;

const textureSize = 1024;

const canvas = document.querySelector('canvas');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;


const gl = canvas.getContext('webgl2', {antialias: false, depth: false});
gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

if(!gl.getExtension('EXT_color_buffer_float')) {
    console.log('float buffers not supported');
}
if(!gl.getExtension('OES_texture_float_linear')){
    console.log('floating point textures not supported')
}

let usingLocalHdri = true;

let currentTexture = 0;

let vertData;
let triData;

let lastTime = 0;
let avgFps = 0;
let frame = 0;

let resLoc;
let rotLoc;

let texLoc;

let frameLoc;
let lastFrameLoc;

let numTris;
let numNodes;
let numMaterials;

let program = gl.createProgram();

let program2 = gl.createProgram();

let useMIS = 1;

let oldTime = 0;

function resetFrame(){
    frame = 0;
    oldTime = 0;
}

console.time('load model');
loadGLTF(MODEL_NAME).then(async (scene) => {
    console.timeEnd('load model');
    console.time('build bvh');
    const BVH = createBVH(scene.tris);
    console.timeEnd('build bvh');
    console.log('num tris: ' + numTris);
    console.log('num nodes: ' + numNodes);

    console.time('compile shaders');
    loadShaders();


    passTextures();

    await loadMaterials(scene.materials, scene.textures);
    await loadHDRI(HDRI_NAME);

    console.timeEnd('compile shaders');

   draw();
});

let framebuffers = [];
let textures = [];
for(let i = 0; i < 2; i++){
    let tex = createTex();
    textures.push(tex);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, Math.ceil(gl.canvas.width*SCALE_FACTOR), Math.ceil(gl.canvas.height*SCALE_FACTOR), 0, gl.RGBA, gl.FLOAT, null);

    let fb = gl.createFramebuffer();
    framebuffers.push(fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
}

function createTex(){
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
 
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
 
    return texture;
}

function loadShaders(){

    //shader initialization
    
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);
    gl.attachShader(program, vertexShader);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, 
    `#version 300 es
    #define NUM_TRIANGLES ${ numTris }
    #define NUM_NODES ${ numNodes }
    #define NUM_MATERIALS ${ numMaterials }
    `+fragmentShaderSource);

    gl.compileShader(fragmentShader);
    gl.attachShader(program, fragmentShader);

    const defaultVert = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(defaultVert, vertexShaderSource);
    gl.compileShader(defaultVert);
    gl.attachShader(program2, defaultVert);

    const defaultFrag = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(defaultFrag, defaultFragSource);
    gl.compileShader(defaultFrag);
    gl.attachShader(program2, defaultFrag);
    gl.linkProgram(program2);
    if(!gl.getProgramParameter(program2, gl.LINK_STATUS)){
        console.log(gl.getShaderInfoLog(defaultVert));
        console.log(gl.getShaderInfoLog(defaultFrag));
    }


    gl.useProgram(program2);    
    resLoc2 = gl.getUniformLocation(program2, 'uRes');
    gl.uniform2f(resLoc2, gl.canvas.width, gl.canvas.height);

    texLoc = gl.getUniformLocation(program2, 'uTex');


    
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program, gl.LINK_STATUS)){
        console.log(gl.getShaderInfoLog(vertexShader));
        console.log(gl.getShaderInfoLog(fragmentShader));
    }
    gl.useProgram(program);
    frameLoc = gl.getUniformLocation(program, 'uFrame');
    lastFrameLoc = gl.getUniformLocation(program, 'uLastFrame');


    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    resLoc = gl.getUniformLocation(program, 'uRes');
    gl.uniform2f(resLoc, Math.ceil(gl.canvas.width*SCALE_FACTOR), Math.ceil(gl.canvas.height*SCALE_FACTOR));

    rotLoc = gl.getUniformLocation(program, 'uRot');

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
}

// this is the post processing fragment shader
const defaultFragSource = /*glsl*/`#version 300 es
precision mediump float;
out vec4 fragColor;

uniform vec2 uRes;
uniform sampler2D uTex;
uniform float uFrame;

// XYZ colorspace -> rgb colorspace
const mat3 xyz2rgb = mat3(
    3.2404542,-0.9692660, 0.0556434,
   -1.5371385, 1.8760108,-0.2040259,
   -0.4985314, 0.0415560, 1.0572252
);

// aces tonemapper
vec3 aces(vec3 x){
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// get luminance of a color
float luminance(vec3 x){
    return dot(x, vec3(0.2126, 0.7152, 0.0722));
}

// reinhard tonemapping
vec3 reinhard(vec3 x){
    float l = luminance(x);
    vec3 tv = x / (1. + x);
    return mix(x / (1. + l), tv, tv);
}

// agx tonemapper lut approximation
vec3 agx(vec3 x){
    x = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
             0.0784335999999992,  0.878468636469772,  0.0784336,
             0.0792237451477643, 0.0791661274605434, 0.879142973793104) * x;
    x = clamp((log2(x) + 12.47393) / 16.5, vec3(0.), vec3(1.));
    x = .5 + .5 * sin(((-3.11 * x + 6.42) * x - .378) * x - 1.44);


    float luma = dot(x, vec3(0.2126, 0.7152, 0.0722));
    x = luma + (pow(max(x*1.2 + vec3(-0.1), 0.), vec3(1.5))-luma);


    return mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                -0.0990297440797205, -0.0989611768448433, 1.15107367264116) * x;
}

// bayer matrices from https://github.com/hughsk/glsl-dither.git
float dither4x4(vec2 position, float brightness) {
    int x = int(mod(position.x, 4.0));
    int y = int(mod(position.y, 4.0));
    int index = x + y * 4;
    float limit = 0.0;
  
    if(x < 8){
        if (index == 0) limit = 0.0625;
        if (index == 1) limit = 0.5625;
        if (index == 2) limit = 0.1875;
        if (index == 3) limit = 0.6875;
        if (index == 4) limit = 0.8125;
        if (index == 5) limit = 0.3125;
        if (index == 6) limit = 0.9375;
        if (index == 7) limit = 0.4375;
        if (index == 8) limit = 0.25;
        if (index == 9) limit = 0.75;
        if (index == 10) limit = 0.125;
        if (index == 11) limit = 0.625;
        if (index == 12) limit = 1.0;
        if (index == 13) limit = 0.5;
        if (index == 14) limit = 0.875;
        if (index == 15) limit = 0.375;
    }
  
    return brightness < limit ? 0. : 1.;
}
  
vec3 dither4x4(vec2 position, vec3 color) {
    return color * dither4x4(position, luminance(color));
}

void main(){
    vec3 col = texture(uTex, gl_FragCoord.xy/uRes).rgb;
    col = max(xyz2rgb * col, 0.);                       // XYZ -> rgb
    
    // col = vec3(1.2, 0.94, 1.)*luminance(col);

    // col = aces(col);
    col = agx(col);
    // col = reinhard(col);

    // col = dither4x4(gl_FragCoord.xy, col * 1.25);
    fragColor = vec4(col, 1.);
}
`;


const checkbox = document.getElementById("use-mis");
checkbox.addEventListener('change', async (e) => {
    resetFrame();
    if(checkbox.checked){
        useMIS = 1;
    } else{
        useMIS = 0;
    }
});

let shouldDownload = false;
document.getElementById('download-button').addEventListener('click', function() {
    shouldDownload = true;
  });

let currentFb = 0;
let dt;

let oldFocalPlane = 0;
let oldBokehStrength = 0;
let oldFocalLength = 0;
let oldExposure = 0;
let oldLightBounces = 0;


// main loop
function draw(timestamp){
    if(oldTime <= 0.001){ oldTime = timestamp; }
    let time = Math.round((timestamp - oldTime)*0.01)/10;
    if(isNaN(time)){ time = 0; }

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    moveCam();


    gl.useProgram(program); 
    gl.uniformMatrix4fv(rotLoc, false, rot);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[currentFb]);


    
    let focalPlane = document.getElementById('focal-plane').value;
    if(focalPlane != oldFocalPlane){ frame = 0; }
    oldFocalPlane = focalPlane;
    focalPlane = 0.1 + 24 * focalPlane*focalPlane;
    gl.uniform1f(gl.getUniformLocation(program, 'uFocalPlane'), focalPlane);

    const bokehStrength = document.getElementById('bokeh-strength').value;
    if(bokehStrength != oldBokehStrength){ frame = 0; }
    oldBokehStrength = bokehStrength;
    gl.uniform1f(gl.getUniformLocation(program, 'uBokehStrength'), bokehStrength);

    const focalLen = document.getElementById('focal-length').value;
    if(oldFocalLength != focalLen){ frame = 0; }
    oldFocalLength = focalLen;
    gl.uniform1f(gl.getUniformLocation(program, 'uFocalLength'), focalLen);

    let exposure = document.getElementById('exposure').value;
    if(oldExposure != exposure){ frame = 0; }
    oldExposure = exposure;
    exposure = 0.05 + 10*exposure*exposure;
    gl.uniform1f(gl.getUniformLocation(program, 'uExposure'), exposure);

    gl.uniform1i(gl.getUniformLocation(program, 'uUseMIS'), useMIS);

    const lightBounces = document.getElementById('light-bounces').value;
    if(oldLightBounces != lightBounces){ frame = 0; }
    oldLightBounces = lightBounces;
    gl.uniform1i(gl.getUniformLocation(program, 'uLightBounces'), lightBounces);

    
    gl.uniform1f(frameLoc, frame);
    gl.activeTexture(gl.TEXTURE0+currentTexture);
    gl.bindTexture(gl.TEXTURE_2D, textures[1-currentFb]);
    gl.uniform1i(lastFrameLoc, currentTexture);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    
    gl.useProgram(program2);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    
    gl.activeTexture(gl.TEXTURE0+currentTexture+1);
    gl.bindTexture(gl.TEXTURE_2D, textures[currentFb]);
    gl.uniform1i(texLoc, currentTexture+1);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);


    dt = (timestamp - lastTime) / 1000;
    if(isNaN(dt)){ dt = 0.1; }

    lastTime = timestamp;
    
    avgFps = (avgFps * frame + (1/dt)) / (frame+1);

    const fpsElement = document.getElementById('fps-counter');
    fpsElement.innerHTML = `FPS: ${Math.round(1/dt)}`;

    const totalSamples = document.getElementById('total-samples');
    totalSamples.innerHTML = `total samples: ${frame + 1}`;

    const totalTime = document.getElementById('time-elapsed');
    totalTime.innerHTML = `elapsed time: ${time}s`;

    frame++;
    currentFb = 1-currentFb;

    if(shouldDownload){
        shouldDownload = false;
        const link = document.createElement('a');
        link.download = 'image.png';
        link.href = canvas.toDataURL();
        link.click();
    }

    requestAnimationFrame(draw);

}


/*
todo:

-use a framebuffer for accumulation             done
-fix issues with bvh causing rays to miss       done
-complete the naive rgb pathtracer              done
    -better diffuse/metallic/specular               done
    -snell's law                                    done
    -fresnel                                        done
    -glass                                          done                            
-implement naive spectral pathtracer            done
-hdr envmap loading                             done
-envmap isampling                               done
-mis >:(                                        done
-importance sample spectrum                     done
-accurate fresnel                               done

*/