// this is the frag shader for the pathtracer

const fragmentShaderSource = /*glsl*/`

precision mediump float;

out vec4 fragColor;

#define EPSILON 0.0001

#define PI 3.14159265
#define TAU 6.28318531

#define DISPERSION_STRENGTH 8. // set to 0 to disable dispersion, higher values = more chromatic abberation

uniform vec2 uRes;
uniform mat4 uRot;

// settings
uniform float uFocalPlane;
uniform float uBokehStrength;
uniform bool uUseMIS;
uniform float uFocalLength;
uniform float uExposure;
uniform int uLightBounces;

uniform sampler2D uTriangleTex;
uniform int uTriMax;

uniform mediump usampler2D uNodeTex;
uniform int uNodeMax;

uniform sampler2D uBoundsTex;

uniform mediump sampler2DArray uTextures;

uniform sampler2D uCIE;
uniform sampler2D uReflectance;

uniform sampler2D uBins;
uniform int uNumBins;

uniform sampler2D uHDRI;

uniform float uFrame;
uniform sampler2D uLastFrame;

uniform float uCIEintegral;

layout(std140) uniform MaterialData {
    vec4 colAlbedoP[NUM_MATERIALS];
    vec4 rmIORP[NUM_MATERIALS];
    vec4 emissiveAndAlpha[NUM_MATERIALS];
    vec4 blankAndNormal[NUM_MATERIALS];
};

struct materialData {
    vec3 albedo;
    float roughness;
    float metallic;
    float ior;
    float transmission;
    vec3 emissive;
    vec3 normal;
};

struct rayInfo{
    vec3 pos;
    vec3 dir;
    vec3 idir;
};

struct hitInfo{
    vec2 uv;
    float t;
    int i;
};

struct triPos{
    vec3 apos;
    vec3 bpos;
    vec3 cpos;
};

struct triData{
    vec3 an;
    vec3 bn;
    vec3 cn;
    vec4 at;
    vec4 bt;
    vec4 ct;
    vec2 auv;
    vec2 buv;
    vec2 cuv;
    float material;
};

// the following code is used to unpack the triangle, bvh, and texture data from the textures
// i packed the data into textures to save vram and due to array length limits on the gpu

materialData getMaterial(int materialIndex, vec2 uv) {
    materialData mat;
    vec4 colorAndPtr = colAlbedoP[materialIndex];
    vec4 roughMetalIorAndPtr = rmIORP[materialIndex];
    vec4 emissiveAndAlphaVal = emissiveAndAlpha[materialIndex];
    vec4 normalVal = blankAndNormal[materialIndex];

    mat.emissive = emissiveAndAlphaVal.rgb;
    if(colorAndPtr.a < 0.){
        mat.albedo = colorAndPtr.rgb;
    }else{
        mat.albedo = pow(texture(uTextures, vec3(uv, colorAndPtr.w)).rgb, vec3(2.2));
    }
    if(roughMetalIorAndPtr.a < 0.){
        mat.metallic = roughMetalIorAndPtr.x;
        mat.roughness = roughMetalIorAndPtr.y;
    }else{
        vec2 data = pow(texture(uTextures, vec3(uv, roughMetalIorAndPtr.w)).gb, vec2(2.2));
        mat.roughness = data.x;
        mat.metallic = data.y;
    }

    mat.roughness = mat.roughness * mat.roughness;
    mat.transmission = emissiveAndAlphaVal.a;
    mat.ior = roughMetalIorAndPtr.z;

    if(normalVal.w < 0.){
        mat.normal = vec3(0., 0., 1.);
    }else{
        mat.normal = texture(uTextures, vec3(uv, normalVal.w)).xyz*2.-1.;
    }


    return mat;
}

void getBounds(int i, out vec3 mi, out vec3 ma){
    ivec2 p = ivec2( 2*(i/uNodeMax), (i%uNodeMax) );
    mi = texelFetch(uBoundsTex, p, 0).xyz;
    ma = texelFetch(uBoundsTex, p+ivec2(1, 0), 0).xyz;
}

uvec4 getNode(int i){
    ivec2 p = ivec2( (i/uNodeMax), (i%uNodeMax) );
    return texelFetch(uNodeTex, p, 0);
}

triPos getTrianglePos(int index){
    ivec2 p = ivec2( 4*(index/uTriMax), 3*(index%uTriMax) );
    triPos tri;
    tri.apos = texelFetch(uTriangleTex, p, 0).xyz;
    tri.bpos = texelFetch(uTriangleTex, p+ivec2(0, 1), 0).xyz;
    tri.cpos = texelFetch(uTriangleTex, p+ivec2(0, 2), 0).xyz;
    return tri;
}

triData getTriData(int index){
    ivec2 p = ivec2( 4*(index/uTriMax), 3*(index%uTriMax) );
    triData t;
    t.auv = texelFetch(uTriangleTex, p+ivec2(1, 0), 0).xy;
    t.buv = texelFetch(uTriangleTex, p+ivec2(1, 1), 0).xy;
    t.cuv = texelFetch(uTriangleTex, p+ivec2(1, 2), 0).xy;

    t.an = texelFetch(uTriangleTex, p+ivec2(2, 0), 0).xyz;
    t.bn = texelFetch(uTriangleTex, p+ivec2(2, 1), 0).xyz;
    vec4 data = texelFetch(uTriangleTex, p+ivec2(2, 2), 0);
    t.cn = data.xyz;

    t.material = data.w;

    t.at = texelFetch(uTriangleTex, p+ivec2(3, 0), 0);
    t.bt = texelFetch(uTriangleTex, p+ivec2(3, 1), 0);
    t.ct = texelFetch(uTriangleTex, p+ivec2(3, 2), 0);
    
    return t;
}


// ray-surface intersection function from https://iquilezles.org/articles/intersectors/
void intersectTriangle( vec3 ro, vec3 rd, vec3 v0, vec3 v1, vec3 v2, int i, inout hitInfo data ){
    vec3 v1v0 = v1 - v0;
    vec3 v2v0 = v2 - v0;
    vec3 rov0 = ro - v0;
    vec3  n = cross( v1v0, v2v0 );
    vec3  q = cross( rov0, rd );
    float d = 1./dot( rd, n );
    float u = d*dot( -q, v2v0 );
    float v = d*dot(  q, v1v0 );
    float t = d*dot( -n, rov0 );
    if( u<0. || v<0. || (u+v)>1. || t > data.t || t < 0. ){ return; }
    data = hitInfo(vec2(u, v), t, i);
}

float intersectBox(rayInfo ray, vec3 mi, vec3 ma){
    ray.pos.x <= ma.x && ray.pos.y <= ma.y && ray.pos.z <= ma.z;

    vec3 tmin = (mi - ray.pos) * ray.idir;
    vec3 tmax = (ma - ray.pos) * ray.idir;

    vec3 t1 = min(tmin, tmax);
    vec3 t2 = max(tmin, tmax);
    float tnear = max(max(t1.x, t1.y), t1.z);
    float tfar = min(min(t2.x, t2.y), t2.z);

    bool hit = tfar >= tnear && tfar >= 0.;

    if(hit){
        if(tnear < 0.){
            return EPSILON;
        }
        return tnear;
    }else{ return 1e12; }
}

//inigo quilez hash
uint hash21( uvec2 p ){
    p *= uvec2(73333,7777);
    p ^= (uvec2(3333777777)>>(p>>28));
    uint n = p.x*p.y;
    return n^(n>>15);
}
float hash( uvec2 p ){
    uint h = hash21( p );
    return float(h)*(1.0/float(0xffffffffU));
}

// cosine weighted hemisphere importance sampling
vec3 cosDir(vec3 normal, uvec2 seed){
    float u = hash(seed);
    float v = hash(seed + uvec2(1390, 313));
    float theta = u * 6.28318531;
    float phi = acos(1. - 2.*v);

    float sinPhi = sin(phi);
    vec3 p = vec3(sinPhi * cos(theta), sinPhi * sin(theta), cos(phi));
    return normalize(normal + p);
}

// some bvh traversal optimizations from the sebastian lague video https://www.youtube.com/watch?v=C1H4zIiCOaI
hitInfo traverseBVH(rayInfo ray){
    int stack[16];
    int stacki = 0;
    stack[stacki++] = 0;
    hitInfo data = hitInfo(vec2(0.), 1e10, 0);
    int escape = 512;
    while(stacki > 0 && escape > 0){
        ivec4 info = ivec4(getNode(stack[--stacki]));

        if(info.y > 0){
            for(int i = info.x; i < info.x + info.y; i++){
                triPos tri = getTrianglePos(i);
                intersectTriangle(ray.pos, ray.dir, tri.apos, tri.bpos, tri.cpos, i, data);
            }
        }else{
            int childai = info.z;
            int childbi = info.w;

            vec3 ami, ama, bmi, bma;
            getBounds(childai, ami, ama);
            getBounds(childbi, bmi, bma);
            float dsta = intersectBox(ray, ami, ama);
            float dstb = intersectBox(ray, bmi, bma);
            
            bool nearest = dsta <= dstb;
            
            float dstnear = nearest ? dsta : dstb;
            float dstfar = nearest ? dstb : dsta;
            
            int neari = nearest ? childai : childbi;
            int fari = nearest ? childbi : childai;

            if(dstfar <= data.t){ stack[stacki++] = fari; }
            if(dstnear <= data.t){ stack[stacki++] = neari; }

        }
        escape--;
    }
    return data;
}

// eric heitz ggx vndf
vec3 samplevndf(vec3 vt, vec2 rng, float alpha){
    vec3 vts = normalize(vec3(vt.xy * alpha, vt.z));

    float phi = TAU * rng.x;
    
    vec3 hemisphere = vec3(cos(phi), sin(phi), 0.);
    hemisphere.z = (1.0 - rng.y) * (1.0 + vts.z) + -vts.z;	
	hemisphere.xy *= sqrt(clamp(1.0 - hemisphere.z * hemisphere.z, 0.0, 1.0));
	hemisphere += vts;
    
    vec3 t = normalize(vec3(hemisphere.xy * alpha, hemisphere.z));

	return t;
}

// code used to sample the hdr skybox color given a direction
vec3 sampleSkybox(vec3 d){
    float phi = atan(d.z, d.x);
    float theta = acos(d.y);
    vec3 col = texture(uHDRI, clamp(vec2(phi/TAU + 0.5, theta/PI), 0., 1.)).rgb;
    // return vec3(0.);
    return col;
}

// algorithm from https://karim.naaji.fr/environment_map_importance_sampling.html
vec3 sampleEmap(uvec2 seed, out float pdf){
    vec4 bin = texelFetch(uBins, ivec2(hash(seed + uvec2(3, 9)) * float(uNumBins), 0), 0);

    vec2 size = vec2(bin.z-bin.x, bin.w-bin.y);
    vec2 uv = vec2(
        bin.x + hash(seed + uvec2(18, 5)) * size.x,
        bin.y + hash(seed + uvec2(17, 6)) * size.y
    );
    uv /= vec2(2048., 1024.);

    float phi = (uv.x-0.5) * TAU;
    float theta = (uv.y) * PI;

    float sint = sin(theta);
    vec3 dir = vec3(sint * cos(phi), cos(theta), sint * sin(phi));

    float area = size.x * size.y;

    float binPdf = ( 2048. * 1024. )/( float(uNumBins) * area );
    pdf = sint == 0. ? 0. : binPdf / (2. * TAU * sint);

    return dir;
}

// tests whether a surface can see the environment map in a specific direction
// used for importance sampling
bool sampleOcclusion(vec3 o,vec3 d){
    rayInfo ray;
    ray.pos = o;
    ray.dir = d;
    ray.idir = 1./d;
    return traverseBVH(ray).t > 1e9;
}

float reflectance(vec3 col, float w){                   // reflectance lookup table - used to convert rgb -> wavelength
    vec3 t = texture(uReflectance, vec2(w, 0.)).rgb;
    return dot(t, col);
}


// the following ggx brdf code is unused but i left it in for reference
// ggx brdf by Eric Heitz

float ggxndf(float NdH, float alpha){
    alpha *= alpha;
    float denom = NdH*NdH*(alpha-1.)+1.;
    return alpha/(PI*denom*denom);
}
float lambda(float NdX, float alpha){
    float alpha2 = alpha*alpha;
    float NdX2 = NdX*NdX;
    return (-1. + sqrt(alpha2*(1.-NdX2)/NdX2+1.))*0.5;
}
float G2(float NdL, float NdV, float alpha){
    float V = lambda(NdV, alpha);
    float L = lambda(NdL, alpha);
    return 1./(1.+V+L);
}
float ggxbrdf(float NdL, float NdV, float NdH, float VdH, float alpha){
    float ndf = ggxndf(NdH, alpha);
    float G2 = G2(NdL, NdV, alpha);
    float a = ndf * G2;
    float b = max(4. * NdL * NdV, 1e-8);
    return a/b;
}
float ggxpdf(float NdH, float alpha){
    return ggxndf(NdH, alpha) * NdH;
}


// mis power heuristic
float powerHeuristic(float a, float b) {
    float a2 = a*a;
    float b2 = b*b;
    return clamp(a2 / max((a2 + b2), EPSILON), 0., 1.);
}

// accurate fresnel equations, better than schlick approximation
// implementation based on blender cycles renderer
// https://github.com/blender/cycles/blob/eadd32bb8a5ffdfe3cf5c3b1821b4222b23366d2/src/kernel/osl/shaders/node_fresnel.h#L8
float fresnel_accurate(float costheta, float eta){
    float c = abs(costheta);
    float g = eta * eta - 1. + c * c;
    if(g > 0.){
        g = sqrt(g);
        float A = (g - c) / (g + c);
        float B = (c * (g + c) - 1.) / (c * (g - c) + 1.);
        return 0.5 * A * A * (1. + B * B);
    }else{
        return 1.;
    }
}

void main(){

    uvec2 seed = uvec2(gl_FragCoord.xy + mod(uFrame * vec2(913.27, 719.92), 9382.239)); // seed for the current sample

    fragColor = vec4(vec3(0.), 1.);

    vec2 jitter = (vec2(hash(seed), hash(seed+uvec2(100, 200))) - 0.5); // free anti aliasing subpixel jitter
    vec2 suv = ((gl_FragCoord.xy + jitter) / uRes - vec2(0.5)) * vec2(-2., 2.);
    suv.x *= uRes.x / uRes.y; // aspect ratio
    
    vec3 camPos = vec3(1., 1., -1.)*uRot[3].xyz + vec3(0.0000001);
    vec3 rayDir = (uFocalPlane/uFocalLength) * vec3(suv, uFocalLength);

    // circle shaped bokeh
    float d = hash(seed+uvec2(31,24));
    vec3 bokeh = vec3( cos(TAU * d), sin(TAU * d), 0.);
    bokeh *= uBokehStrength*pow(hash(seed+uvec2(81, 3)), 0.5);


    rayDir =  normalize(rayDir - bokeh) * mat3(uRot);

    camPos += bokeh * mat3(uRot);
    
    rayInfo ray = rayInfo(camPos, rayDir, vec3(1.)/rayDir);
    
    // importance sampling wavelengths - sample inverse cdf then find the pdf
    // range of wavelengths: 380 - 700nm
    float lambda = hash(seed + uvec2(10, 19));
    float wavelength = texture(uCIE, vec2(lambda, 0.5)).w; // inverse cdf lut stored in the w component
    vec3 lut = texture(uCIE, vec2(wavelength, 0.5)).xyz;
    float wpdf = max((lut.x + lut.y + lut.z)/uCIEintegral, 0.01);
    
    float radiance = 0.;
    float throughput = 1.;
    
    vec3 test = vec3(0.);
    for(int i = 0; i < uLightBounces; i++){ // number of light bounces


        // SHOOT RAY
        hitInfo hit = traverseBVH(ray);

        // i use this to visualize the focus distance for the depth of field
        // if(abs(hit.t - FOCUS_DIST) < 0.02){ radiance = 100.; break; }
        
        if(hit.t >= 1e9){ 
            // BACKGROUND
            vec3 sky = sampleSkybox(ray.dir);                             // sample the hdri
            // vec3 sky = i == 0 ? vec3(0.) : sampleSkybox(ray.dir);    // sample the hdri on anything but the initial bounce
            radiance += reflectance(sky, wavelength);
            
            break; 
        }

        vec3 bary = vec3(hit.uv, 1.-(hit.uv.x + hit.uv.y));

        triPos pos = getTrianglePos(hit.i);
        triData data = getTriData(hit.i);


        // MATERIALS
        vec2 uv = bary.z * data.auv + bary.x * data.buv + bary.y * data.cuv;
        materialData material = getMaterial(int(data.material), uv);

        float alpha = material.roughness * material.roughness;
        alpha = material.roughness;

        // NORMALS
        vec3 geonormal, normal;

        geonormal = normalize(cross(pos.apos-pos.bpos, pos.apos-pos.cpos));
        normal = normalize(bary.z * data.an + bary.x * data.bn + bary.y * data.cn);


        float orientation = -dot(geonormal, ray.dir);
        orientation = orientation/abs(orientation);
        normal *= orientation;
        geonormal *= orientation;

        vec3 tangent;

        vec4 temp = normalize(bary.z * data.at + bary.x * data.bt + bary.y * data.ct);
        tangent = normalize(temp.xyz * temp.w);
        
        vec3 bitangent = normalize(cross(normal, tangent));

        ray.pos = ray.pos + (ray.dir * hit.t) + (geonormal * EPSILON);


        mat3 tbn;
        tbn[0] = tangent;
        tbn[1] = bitangent;
        tbn[2] = normal;

        vec3 nmap = tbn * (vec3(1.4142, 1.4142, 1.) * material.normal);
        normal = normalize(normal + vec3(2.) * nmap);
        

        tbn[1] = normalize(cross(normal, tangent));
        tbn[2] = normal;

        float mior = material.ior;
        
        // a very crude approximation of wavelength dependent ior
        mior = pow(wavelength-0.5, 3.) * (mior-1.) * 3. + mior;
        // but it looks good and is relatively cheap

        float rayIOR = 1., surfaceIOR = 1.;
        if(orientation > 0.){
            surfaceIOR = mior;
        }else{
            rayIOR = mior;
            material.albedo = vec3(1.);
        }


        // MICROFACET NORMAL
        vec3 ht = samplevndf(-ray.dir * tbn, vec2(hash(uvec2(3)*seed + uvec2(39, 13)), hash(seed + uvec2(1, 178))), alpha);
        vec3 microfacetNormal = tbn[0] * ht.x + tbn[1] * ht.y + tbn[2] * ht.z;

        
        // RAY DIRECTIONS
        vec3 reflection = reflect(ray.dir, microfacetNormal);
        vec3 lambert = cosDir(normal, seed);

        // FRESNEL

        float cost = dot(ray.dir, microfacetNormal);

        // uncomment this code to use schlick's approximation of fresnel
        /*
        float f = (rayIOR-surfaceIOR)/(rayIOR+surfaceIOR);
        f = f*f;
        float fresnel = f + (1.-f) * pow(1.+cost, 5.);
        */
       
        float fresnel = fresnel_accurate(cost, surfaceIOR/rayIOR);
       
        float isSpecular = 0.;
        float transmissionTest = 1.;

        vec3 wo;    // outgoing ray direction

        bool isGlossy = true;

        // material system loosely based off of blender's principled bsdf

        if(hash(seed + uvec2(1, 0)) < material.metallic){

// METALLIC
            wo = reflection;

        }else{
            float sint = sqrt(1.- cost*cost); // total internal reflection

            if((hash(seed + uvec2(2, 0)) < fresnel || (sint * (rayIOR/surfaceIOR) > 1.))){
// SPECULAR
                wo = reflection;
                isSpecular = 1.;

            }else{
                float sint = sqrt(1.- cost*cost);

                if(hash(seed + uvec2(3, 0)) < material.transmission){
// TRANSMISSION
                    ray.pos += EPSILON * -2. * normal;

                    wo = refract(ray.dir, microfacetNormal, rayIOR/surfaceIOR);    

                    transmissionTest = -1.;

                }else{
// DIFFUSE
                    wo = lambert;
                    isGlossy = false;
                    
                }
            }
        }

        // energy conservation:
        // if the outgoing ray is pointed towards the inside of the surface, reflect it
        // this fixes issues with both smooth shading and normal maps without the need for a multiscatter model
        if(dot(wo, geonormal)*transmissionTest < 0.){
            wo = reflect(wo, geonormal);
        }


        float term = mix(clamp(reflectance(material.albedo, wavelength), 0., 1.), 1., isSpecular);


        if(uUseMIS){

            // multiple importance sampling only for diffuse surfaces
            // because my vndf energy conservation hack doesn't obey the ggx brdf
            
            float ipdf = dot(wo, normal)/PI;

            float pdf;
            vec3 edir = sampleEmap(seed, pdf);
            pdf = max(pdf, EPSILON);

            float misWeight = isGlossy ? 0. : powerHeuristic(pdf, ipdf);
            
            vec3 h = normalize(-ray.dir + edir);

            if(dot(edir, normal) > 0.){ 
                if(sampleOcclusion(ray.pos, edir)){
                    float brdf = dot(edir, normal) * 0.5 * term;
                    radiance += misWeight * reflectance(sampleSkybox(edir), wavelength) / pdf * brdf * throughput;
                }
            }
        }

        
        radiance += reflectance(material.emissive, wavelength) * throughput;
        
        throughput *= term;

        // russian roulette
        // the selection is nice and simple in a spectral renderer because the throughput is a float
        
        float rr = throughput;
        rr = clamp(rr * 1.333, 0., 1.);         // 1.333 is a user defined value, lower values = lower chance to terminate early
        if(hash(seed+uvec2(18, 31)) > rr){
            break;
        }
        throughput *= 1./rr;                    // rr energy conservation

        seed += uvec2(1317, 739);
        ray.dir = wo;
        ray.idir = 1./wo;
    }
    
    // clamp the radiance to prevent fireflies
    // physically incorrect but adjusts for not having importance sampling on the ggx brdf
    if(uUseMIS){
        radiance = min(radiance, 500.);
    }
    
    // spectral wavelength to rgb conversion part 1
    vec3 col = uExposure * 0.05 * radiance * texture(uCIE, vec2(wavelength, 0.5)).rgb / wpdf;

    vec3 lastFrame = texture(uLastFrame, gl_FragCoord.xy/uRes).rgb;         // for averaging frames together (monte carlo)
    fragColor.rgb = (col + lastFrame*uFrame)/(uFrame+1.);
}
`;