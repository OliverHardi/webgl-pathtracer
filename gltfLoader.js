// this file handles loading gltf files from the server or from the user
/*
requrires a somewhat specific format, I recommend using the gltf exporter in blender:
- only handles gltf separate (.gLTF + .bin + textures)
- meshes must be triangulated on export (quads work too)
- apply modifiers, you can do this on the export window on blender
- under data -> mesh check the following
    - apply modifiers
    - UVs
    - Normals
    - Tangents
- no support for animations
*/

// this file also contains code for handling HDRIs (only supports .hdr)


// GLTF LOADING CODE

// load gltf from a local file
async function loadGLTF(name) {
    const url = 'assets/' + name + '/' + name + '.gltf';
    const response = await fetch(url);
    const gltf = await response.json();
    const bufferResponse = await fetch('assets/' + name + '/' + gltf.buffers[0].uri);
    const buffer = await bufferResponse.arrayBuffer();

    const images = {};
    if (gltf.images !== undefined) {
        await Promise.all(gltf.images.map(async (img) => {
            
            const imageURI = img.uri;
            const imageURL = 'assets/'+name + '/' + imageURI;
            const image = new Image();
            image.src = imageURL;

            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = reject;
            });

            const filename = imageURI.split('/').pop();
            images[filename] = image;
        }));
    }
    return handleGLTF(gltf, buffer, images);
}

// load gltf uploaded by the user
document.getElementById('gltf-folder-input').addEventListener('change', async (event) => {
    console.clear();

    console.time('load gltf');
    const files = Array.from(event.target.files);

    // files
    const fileMap = {};
    for (const file of files) {
        fileMap[file.name] = file;
    }

    // get gltf
    const gltfFile = files.find(f => f.name.endsWith('.gltf'));
    if (!gltfFile) {
        console.error('no .gltf file found');
        console.error('make sure you upload as a separate gltf + bin and textures in a folder called textures')
        return;
    }

    // gltf json
    const gltfJSON = JSON.parse(await gltfFile.text());

    // bin
    const bufferDef = gltfJSON.buffers?.[0];
    const binFile = fileMap[bufferDef.uri];
    const buffer = await binFile.arrayBuffer();


    // load images into a map indexed by filename
    const images = {};

    if(gltfJSON.images !== undefined){
        await Promise.all(
            gltfJSON.images.map(async (img) => {
                const filename = img.uri.split('/').pop();

                const file = files.find(f => f.name.endsWith(filename));
                if (!file) {
                    console.warn(`Missing image: ${img.uri}`);
                    return;
                }

                const url = URL.createObjectURL(file);
                const image = new Image();
                image.src = url;

                await new Promise((resolve, reject) => {
                    image.onload = resolve;
                    image.onerror = reject;
                });

                images[filename] = image; // store in map by name
            })
        );
    }
    console.timeEnd('load gltf');
    handleGLTF(gltfJSON, buffer, images).then(async (scene) => {

        currentTexture = 0;

        console.time('build bvh');

        trisBVH = [];
        nodesBVH = [];
        stackBVH = [];
        const BVH = createBVH(scene.tris);
        console.timeEnd('build bvh');
        console.log('num tris: ' + numTris);
        console.log('num nodes: ' + numNodes);

        if(program){
            gl.deleteProgram(program);
        }
        program = gl.createProgram();

        if(program2){
            gl.deleteProgram(program2);
        }
        program2 = gl.createProgram();

        console.time('compile shaders');
        loadShaders();

        passTextures();

        await loadMaterials(scene.materials, scene.textures);

        if(usingLocalHdri){
            await loadHDRI(HDRI_NAME);
        }else{
            handleHDRI(0, 0, 0, true);
        }

        console.timeEnd('compile shaders');
        

        resetFrame();
    });
});


async function handleGLTF(gltf, buffer, images){

    let materials = [];

    for(const material of gltf.materials){
        let mat = {};
        mat.name = material.name;
        const temp = material.pbrMetallicRoughness
        if(temp != undefined){
            if(temp.baseColorTexture != undefined){
                mat.albedoTex = gltf.images[gltf.textures[temp.baseColorTexture.index].source].uri.split('/').pop();
                mat.albedo = [0, 0, 0];
            }else{
                mat.albedoTex = -1;
                if(temp.baseColorFactor == undefined){
                    mat.albedo = [1, 1, 1];
                }else{
                    mat.albedo = [temp.baseColorFactor[0], temp.baseColorFactor[1], temp.baseColorFactor[2]];
                }
            }
            if(temp.metallicRoughnessTexture != undefined){
                mat.mr = [0, 1];
                mat.mrTex = gltf.images[gltf.textures[temp.metallicRoughnessTexture.index].source].uri.split('/').pop();
            }else{
                mat.mr = [];
                if(temp.metallicFactor == undefined){
                    mat.mr.push(0);
                }else{
                    if(temp.metallicFactor > 0.9){     // there's a bug with the gltf exporter in blender where a metallicFactor of 1 doesn't export at all
                        mat.mr.push(1);
                    }else{
                        mat.mr.push(temp.metallicFactor);
                    }
                }
                if(temp.roughnessFactor == undefined){
                    mat.mr.push(0.5);
                }else{
                    mat.mr.push(temp.roughnessFactor);
                }
                mat.mrTex = -1;
            }

            if(material.emissiveFactor == undefined){
                mat.emissive = [0, 0, 0];
            }else{
                const m1 = material.extensions?.KHR_materials_emissive_strength?.emissiveStrength || 1;
                const m2 = material.emissiveFactor;
                mat.emissive = [m2[0]*m1, m2[1]*m1, m2[2]*m1];
            }
            mat.ior = 1.5;
            mat.transmission = 0;
            if(material.extensions != undefined){
                const temp2 = material.extensions;
                if(temp2.KHR_materials_ior != undefined){mat.ior = temp2.KHR_materials_ior.ior; }
                if(temp2.KHR_materials_transmission != undefined){ mat.transmission = temp2.KHR_materials_transmission.transmissionFactor; }
            }

            mat.normal = -1;
            if(material.normalTexture != undefined){
                mat.normal = gltf.images[gltf.textures[material.normalTexture.index].source].uri.split('/').pop();
            }

        }else{
            
        }
        materials.push(mat);
    }
    numMaterials = materials.length;

    let triangles = [];

    for(const node of gltf.nodes){
        if(node.mesh == undefined){ continue; }  
        const mesh = gltf.meshes[node.mesh];
        
        let translation = vec3.fromValues(0, 0, 0);
        let scale = vec3.fromValues(1, 1, 1);
        let quaternion = quat.create();
        if(node.translation != undefined){
            translation = node.translation;
        }
        if(node.scale != undefined){
            scale = node.scale;
        }
        if(node.rotation != undefined){
            quaternion = quat.fromValues(...node.rotation);
        }
        for(const primitive of mesh.primitives){
            let materialIndex = primitive.material;
            if(materialIndex == undefined){ materialIndex = 0; }

            const attributes = primitive.attributes;
            
            const indices = handleAttribute(gltf, buffer, primitive.indices);

            const positions = handleAttribute(gltf, buffer, attributes.POSITION);   
            const normals = handleAttribute(gltf, buffer, attributes.NORMAL);
            const uvs = handleAttribute(gltf, buffer, attributes.TEXCOORD_0);
            const tangents = handleAttribute(gltf, buffer, attributes.TANGENT);
            
            let tri = {verts: [], material: materialIndex};
            for(let i = 0; i < indices.length; i++){
                const index = indices[i];
                let vert = {};
                
                let pos = vec3.fromValues(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
                vec3.multiply(pos, pos, scale);
                vec3.transformQuat(pos, pos, quaternion);
                vec3.add(pos, pos, translation);

                vert.pos = [...pos];
                
                let n = vec3.fromValues(normals[index * 3], normals[index * 3 + 1], normals[index * 3 + 2]);
                vec3.multiply(n, n, scale);
                vec3.transformQuat(n, n, quaternion);
                vec3.normalize(n, n);
                vert.normal = [...n];
                
                vert.uv = [uvs[index * 2], uvs[index * 2 + 1]];
                
                vert.tangent = [tangents[index * 4], tangents[index * 4 + 1], tangents[index * 4 + 2], tangents[index * 4 + 3]];
                
                tri.verts.push(vert);
                if(i%3==2){
                    triangles.push(tri);
                    tri = {verts: [], material: materialIndex};
                }
            }
        }

    }

    numTris = triangles.length;
    return {tris: triangles, materials: materials, textures: images};
}

function handleAttribute(gltf, buffer, i){
    const accessor = gltf.accessors[i];


    const view = gltf.bufferViews[accessor.bufferView];
    const componentType = accessor.componentType;
    const elementSize = getElementSize(accessor.type);
    const TypedArrayConstructor = getTypedArrayConstructor(componentType);

    if (!TypedArrayConstructor) {
    console.warn(`error: ${componentType}`);
    return;
    }

    const array = new TypedArrayConstructor(buffer, view.byteOffset, accessor.count * elementSize);
    return Array.from(array);
}
  
function getElementSize(type) {
    switch (type) {
        case 'SCALAR': return 1;
        case 'VEC2': return 2;
        case 'VEC3': return 3;
        case 'VEC4': return 4;
        default: return 1;
    }
}

function getTypedArrayConstructor(componentType) {
    switch (componentType) {
        case 5120: return Int8Array;
        case 5121: return Uint8Array;
        case 5122: return Int16Array;
        case 5123: return Uint16Array;
        case 5125: return Uint32Array;
        case 5126: return Float32Array;
        default: return null;
    }
}


// HDRI LOADING CODE



// handles user-uploaded hdris
document.getElementById('gltf-hdri-input').addEventListener('change', async (event) => {

    resetFrame();

    usingLocalHdri = false;

    const file = event.target.files[0];
    const buffer = await file.arrayBuffer();
    const byteArray = new Uint8Array(buffer);

    const result = parseHDR(byteArray);

    handleHDRI(result.width, result.height, result.pixels)

});

// parses the hdr file, uses RLE (run length encoding)
function parseHDR(bytes){
    let ptr = 0;

    function readLine() {
        let line = '';
        while(ptr < bytes.length){
            const byte = bytes[ptr++];
            if (byte === 0x0A) break; // newline
            line += String.fromCharCode(byte);
        }
        return line;
    }

    let width = 0, height = 0;
    let format = '';
    while(true){
        const line = readLine();
        if(line.startsWith('#') || line === '') continue;
        if(line.startsWith('FORMAT=')) {
            format = line.trim();
        }
        if(line.startsWith('-Y') || line.startsWith('+Y')){
            const parts = line.trim().split(' ');
            height = parseInt(parts[1], 10);
            width = parseInt(parts[3], 10);
            break;
        }
    }

    if(format !== 'FORMAT=32-bit_rle_rgbe'){
        throw new Error('Unsupported HDR format: ' + format);
    }

    const data = new Float32Array(width * height * 3);
    const scanline = new Uint8Array(width * 4);
    let offset = 0;

    for(let y = 0; y < height; y++){
        // rle header
        if(bytes[ptr++] !== 2 || bytes[ptr++] !== 2){
            throw new Error('Invalid HDR RLE header');
        }

        const scanlineWidth = (bytes[ptr++] << 8) + bytes[ptr++];
        if(scanlineWidth !== width) {
            throw new Error('Scanline width mismatch');
        }

        // run length encoding for each channel, rgbe
        for(let channel = 0; channel < 4; channel++){
            let i = 0;
            while(i < width){
                const count = bytes[ptr++];
                if (count > 128) {
                    const value = bytes[ptr++];
                    for(let j = 0; j < count - 128; j++){
                        scanline[i * 4 + channel] = value;
                        i++;
                    }
                }else{
                    for(let j = 0; j < count; j++){
                        scanline[i * 4 + channel] = bytes[ptr++];
                        i++;
                    }
                }
            }
        }
        for(let x = 0; x < width; x++){
            const r = scanline[x * 4 + 0];
            const g = scanline[x * 4 + 1];
            const b = scanline[x * 4 + 2];
            const e = scanline[x * 4 + 3];

            if(e > 0){
                const f = Math.pow(2.0, e - 136); // 128 bias + 8 mantissa
                data[offset++] = r * f;
                data[offset++] = g * f;
                data[offset++] = b * f;
            }else{
                data[offset++] = 0;
                data[offset++] = 0;
                data[offset++] = 0;
            }
        }
    }

    return { width: width, height: height, pixels: data };
}



let bins = [];

let hdriData;
let hdriWidth;
let hdriHeight;


// recursive function to split the current bin (new branch on the binary tree)
function getRadiance(x, y){
    return hdriData[3*(y * hdriWidth + x)] + hdriData[3*(y * hdriWidth + x)+1] + hdriData[3*(y * hdriWidth + x)+1];
}

let minnx = 10000;
let minny = 10000;

// algorithm from https://karim.naaji.fr/environment_map_importance_sampling.html
function processBins(ax, ay, bx, by, oldRadiance, depth){
    const w = bx-ax;
    const h = by-ay;
    


    if(oldRadiance < 80000 || w * h < 1*1 || depth > 32){
        bins.push(ax, ay, bx, by);

        return;
    }

    const temp = w > h;
    const xsplit = temp ? ax + w*0.5 : bx;
    const ysplit = temp ? by : ay + h*0.5;

    let newRadiance = 0;
    for(let x = ax; x < xsplit; x++){
        for(let y = ay; y < ysplit; y++){
            newRadiance += getRadiance(x, y);
        }
    }


    processBins(ax, ay, xsplit, ysplit, newRadiance, depth+1);
    
    if(temp){
        processBins(xsplit, ay, bx, by, oldRadiance-newRadiance, depth+1);
    }else{
        processBins(ax, ysplit, bx, by, oldRadiance-newRadiance, depth+1);
    }
}

// this is the function that loads the hdri from the server
async function loadHDRI(name){

    const response = await fetch('hdris/'+name+'.hdr');
    if (!response.ok) throw new Error(`Failed to load HDRI: ${response.statusText}`);
  
    const arrayBuffer = await response.arrayBuffer();
    const byteData = new Uint8Array(arrayBuffer);
  
    const data = parseHDR(byteData);

    handleHDRI(data.width, data.height, data.pixels);
}

// this function handles the hdri data and creates a texture from it
// it also creates the bins for the hdri
// the bins are used for importance sampling
// the bins are created by splitting the hdri into smaller sections and putting them into a binary tree
function handleHDRI(width, height, pixels, redoBins = false){
    gl.useProgram(program);

    if(!redoBins){
        hdriData = pixels;
        hdriWidth = width;
        hdriHeight = height;

        let radiance = 0;
        for(let x = 0; x < width; x++){
            for(let y = 0; y < height; y++){
                radiance += getRadiance(x, y);
            }
        }
        processBins(0, 0, width, height, radiance, 0);
    }

    const binsTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + currentTexture);
    gl.bindTexture(gl.TEXTURE_2D, binsTex);
    const bins32 = new Float32Array(bins);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, bins.length/4, 1, 0, gl.RGBA, gl.FLOAT, bins32);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    const binsLoc = gl.getUniformLocation(program, 'uBins');
    gl.uniform1i(binsLoc, currentTexture);

    currentTexture++;

    const numBinsLoc = gl.getUniformLocation(program, 'uNumBins');
    gl.uniform1i(numBinsLoc, bins.length/4);

    const hdriTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + currentTexture);
    gl.bindTexture(gl.TEXTURE_2D, hdriTex);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, 2048, 1024, 0, gl.RGB, gl.FLOAT, hdriData);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    const hdriLoc = gl.getUniformLocation(program, 'uHDRI');
    gl.uniform1i(hdriLoc, currentTexture);

    currentTexture++;
}
