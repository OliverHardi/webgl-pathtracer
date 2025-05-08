// this file handles passing the data from the cpu to the gpu
// the larger arrays and data structures I handle as textures on the gpu due to size limitations and speed requirements

// looks up a wavelength in the table given a number
function sampleWavelength(cdf, xi){
    for (let i = 1; i < cdf.length; i++) {
        const cdfa = cdf[i-1];
        const cdfb = cdf[i];

        if(xi >= cdfa && xi <= cdfb){
            const t = (xi - cdfa) / (cdfb - cdfa);
            const lambdaa = i-1;
            const lambdab = i;
            return (lambdaa * (1 - t) + lambdab * t)/cdf.length;
        }
    }
    return 1;
}

function passTextures(){

    gl.useProgram(program);

    const maxSize = 4096 * 2;                                                   // maximum number of lines on y
                                                                                // change this to change the max size of the textures
    const triMaxSize = Math.floor(maxSize/3)*3;                                 // how many triangles we can fit on the y tex with 3 verts per triangle
    const triTexHeight = Math.min(trisBVH.length * 3, triMaxSize);              // how many lines we need to allocate (either the max size or num tris)

    const triTexWidth = 4*(Math.ceil((trisBVH.length*3)/triMaxSize));           // number of verts rounded up to the nearest number of y lines
                                                                                // then multiplied by number of pixels per vert

    const triTempWidth = triTexWidth * 4;                                       // temp var (dont touch, 4 is for rgba)

    const triMaxLoc = gl.getUniformLocation(program, 'uTriMax');
    gl.uniform1i(triMaxLoc, (triTexHeight)/3);


    const triTexData = new Float32Array(triTexHeight * triTempWidth);

    for(let i = 0; i < trisBVH.length; i++){
        let tri = trisBVH[i];
        const v = tri.verts;
        const x = 4 * 4 * Math.floor((i*3)/ triTexHeight );
        const y = (i*3)%triTexHeight;
        for(let j = 0; j < 3; j++){
             // can replace material pointer in some of these with something else, just a placeholder value
            triTexData.set([...v[j].pos,    tri.material],   ( (x  ) + (y+j) * triTempWidth ) );
            triTexData.set([...v[j].uv, -1, tri.material],   ( (x+4) + (y+j) * triTempWidth ) );
            triTexData.set([...v[j].normal, tri.material],   ( (x+8) + (y+j) * triTempWidth ) );
            triTexData.set([...v[j].tangent],                ( (x+12) + (y+j) * triTempWidth ) );
        }
    }
    const triangleTex = gl.createTexture();


    gl.activeTexture(gl.TEXTURE0+currentTexture);

    gl.bindTexture(gl.TEXTURE_2D, triangleTex);
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA32F, triTexWidth, triTexHeight, 0, gl.RGBA, gl.FLOAT, triTexData );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.bindTexture(gl.TEXTURE_2D, triangleTex);
    
    const triangleTexLoc = gl.getUniformLocation(program, "uTriangleTex");
    gl.uniform1i(triangleTexLoc, currentTexture);

    currentTexture++;

    // nodes

    const nodeTexHeight = Math.min(nodesBVH.length, maxSize);
    const nodeTexWidth = Math.ceil((nodesBVH.length)/maxSize);

    const boundsTexWidth = 2*nodeTexWidth;

    const nodeMaxLoc = gl.getUniformLocation(program, 'uNodeMax');
    gl.uniform1i(nodeMaxLoc, nodeTexHeight);
    
    const nodeTempWidth = nodeTexWidth * 4;
    const boundsTempWidth = boundsTexWidth * 3;

    const nodeTexData = new Uint32Array(nodeTexHeight * nodeTempWidth);
    const boundsTexData = new Float32Array(nodeTexHeight * boundsTempWidth);

    for(let i = 0; i < nodesBVH.length; i++){
        const node = nodesBVH[i];

        const AABB = node.bounds;
        const x1 = 4*Math.floor( i/nodeTexHeight );
        const x2 = 3*2*Math.floor( i/nodeTexHeight );
        const y = i%nodeTexHeight;

        nodeTexData.set([node.start, node.len, node.childa, node.childb], (x1) + y * nodeTempWidth);

        boundsTexData.set([AABB[0][0], AABB[1][0], AABB[2][0]], ( (x2) + (y) * boundsTempWidth ) );
        boundsTexData.set([AABB[0][1], AABB[1][1], AABB[2][1]], ( (x2+3) + (y) * boundsTempWidth ) );
    }

    const nodeTex = gl.createTexture();
    
    gl.activeTexture(gl.TEXTURE0+currentTexture);
    gl.bindTexture(gl.TEXTURE_2D, nodeTex);
    
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA32UI, nodeTexWidth, nodeTexHeight, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, nodeTexData );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const nodeTexLoc = gl.getUniformLocation(program, "uNodeTex");
    gl.uniform1i(nodeTexLoc, currentTexture);


    currentTexture++;


    const boundsTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0+currentTexture);
    gl.bindTexture(gl.TEXTURE_2D, boundsTex);
    
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGB32F, boundsTexWidth, nodeTexHeight, 0, gl.RGB, gl.FLOAT, boundsTexData );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const boundsTexLoc = gl.getUniformLocation(program, "uBoundsTex");
    gl.uniform1i(boundsTexLoc, currentTexture);


    currentTexture++;

    // code to create a LUT stored in the w/a channel of the CIE LUT texture
    // this is used to importance sample wavelengths that contribute more to percieved radiance

    let integral = 0;   // find integral of the summed components of the cie curve
    for(let i = 0; i < cie.length; i+=4){
        integral += cie[i] + cie[i + 1] + cie[i + 2];
    }

    gl.uniform1f( gl.getUniformLocation(program, "uCIEintegral"), integral/320);

    const len = cie.length/4;

    const delta = 1;
    const cdf = new Float32Array(len);
    cdf[0] = 0;

    for(let i = 1; i < len; i++){
        const idx = i * 4;
        const prevIdx = (i - 1) * 4;

        const a = cie[idx] + cie[idx + 1] + cie[idx + 2];
        const b = cie[prevIdx] + cie[prevIdx + 1] + cie[prevIdx + 2];

        cdf[i] = cdf[i-1] + 0.5 * delta * (a + b)/integral;   // the cdf is stored in the alpha component
    }
    // linear search to invert the table, not the most optimal but it works
    for(let i = 0; i < len; i++){
        const x = i/(len-1);
        const g = sampleWavelength(cdf, x);

        cie[i * 4 + 3] = g;
    }


    const cieTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0+currentTexture);
    gl.bindTexture(gl.TEXTURE_2D, cieTex);

    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA32F, cie.length/4, 1, 0, gl.RGBA, gl.FLOAT, cie);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const cieTexLoc = gl.getUniformLocation(program, "uCIE");

    gl.uniform1i(cieTexLoc, currentTexture);
    currentTexture++;


    const reflectanceTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0+currentTexture);
    gl.bindTexture(gl.TEXTURE_2D, reflectanceTex);

    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGB32F, reflectance.length/3, 1, 0, gl.RGB, gl.FLOAT, reflectance);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const reflectanceTexLoc = gl.getUniformLocation(program, "uReflectance");

    gl.uniform1i(reflectanceTexLoc, currentTexture);
    currentTexture++;
}


/*
        for every material, create a ubo of it:

        albedo tex pointer (int)
        albedo color (used if ptr = -1)
        alpha/transparency - float
        roughness/metallic (vec2)
        roughness/metalic texture (used if ptr = -1)
        emissive value (vec3)
        ior - float

        so we can pack it to:
        vec4 - color + pointer 
        vec4 - roughness + metallic + ior + pointer
        vec4 - emissive + transmission
        vec4 - blank3 + nmap
*/


async function loadMaterials(materials, textures){

    gl.useProgram(program);

    let adata = [];
    let bdata = [];
    let cdata = [];
    let ddata = [];
    let images = [];
    for(material of materials){
        adata.push(...material.albedo);
        if(material.albedoTex == -1){
            adata.push(-1);
        }else{
            const albedoData = textures[material.albedoTex];
            adata.push(images.length);
            images.push(albedoData);
        }

        bdata.push(...material.mr, material.ior);
        if(material.mrTex == -1){
            bdata.push(-1);
        }else{
            const mrData = textures[material.mrTex];
            bdata.push(images.length);
            images.push(mrData);
        }
        cdata.push(...material.emissive, material.transmission);
        ddata.push(1., 1., 1.);

        if(material.normal == -1){
            ddata.push(-1);
        }else{
            const normalData = textures[material.normal];
            ddata.push(images.length);
            images.push(normalData);
        }
    }

    const materialData = new Float32Array([...adata, ...bdata, ...cdata, ...ddata]);

    const ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, materialData.byteLength, gl.DYNAMIC_DRAW);
    
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, materialData);

    const blockIndex = gl.getUniformBlockIndex(program, "MaterialData");
    gl.uniformBlockBinding(program, blockIndex, 0);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
    

    
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 8, gl.RGBA8, textureSize, textureSize, Math.max(images.length, 1));
    for(let i = 0; i < images.length; i++){
        const image = images[i];
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, textureSize, textureSize, 1, gl.RGBA, gl.UNSIGNED_BYTE, image);
    }
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    const texturesLoc = gl.getUniformLocation(program, 'uTextures');
    gl.activeTexture(gl.TEXTURE0 + currentTexture);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.uniform1i(texturesLoc, currentTexture);
    

    currentTexture++;

}