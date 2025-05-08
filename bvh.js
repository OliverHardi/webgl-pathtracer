// this file builds a bvh tree from the triangles in the scene

const NUM_BINS = 8;
const MAX_DEPTH = 32;

function newAABB(){
    return [
        [Infinity, -Infinity],
        [Infinity, -Infinity],
        [Infinity, -Infinity]
    ]
}

function newNode(){
    return {
        start: 0,
        len: 0,
        bounds: [
            [0, 1],
            [0, 100],
            [0, 1]
        ],
        childa: 0,
        childb: 0,
    }
}

function growBounds(bounds, p){
    //console.log(bounds);
    bounds[0][0] = Math.min(bounds[0][0], p[0]);
    bounds[1][0] = Math.min(bounds[1][0], p[1]);
    bounds[2][0] = Math.min(bounds[2][0], p[2]);
    
    bounds[0][1] = Math.max(bounds[0][1], p[0]);
    bounds[1][1] = Math.max(bounds[1][1], p[1]);
    bounds[2][1] = Math.max(bounds[2][1], p[2]);

    return bounds;
}

function mmax(bounds, mi, ma){
    bounds[0][0] = Math.min(bounds[0][0], mi[0]);
    bounds[1][0] = Math.min(bounds[1][0], mi[1]);
    bounds[2][0] = Math.min(bounds[2][0], mi[2]);
    
    bounds[0][1] = Math.max(bounds[0][1], ma[0]);
    bounds[1][1] = Math.max(bounds[1][1], ma[1]);
    bounds[2][1] = Math.max(bounds[2][1], ma[2]);
    return bounds;
}


function longestAxis(b){
    const extents = [
        b[0][1] - b[0][0],
        b[1][1] - b[1][0],
        b[2][1] - b[2][0]
    ]
    return extents.indexOf(Math.max(...extents));
}



let trisBVH = [];
let nodesBVH = [];
let stackBVH = [];

function pushToStack(t, p, d){
    const temp = {tris: t, parent: p, depth: d};
    stackBVH.push(temp);
}

function createBVH(tris){
    trisBVH = [];
    nodesBVH = [];
    stackBVH = [];

    for(let tri of tris){
        tri.midpoint = [
            (tri.verts[0].pos[0] + tri.verts[1].pos[0] + tri.verts[2].pos[0])/3,
            (tri.verts[0].pos[1] + tri.verts[1].pos[1] + tri.verts[2].pos[1])/3,
            (tri.verts[0].pos[2] + tri.verts[1].pos[2] + tri.verts[2].pos[2])/3,
        ];
        let bounds = newAABB();

        bounds = growBounds(bounds, tri.verts[0].pos);
        bounds = growBounds(bounds, tri.verts[1].pos);
        bounds = growBounds(bounds, tri.verts[2].pos);

        tri.mi = [bounds[0][0], bounds[1][0], bounds[2][0]];
        tri.ma = [bounds[0][1], bounds[1][1], bounds[2][1]];
    }

    pushToStack(tris, -1, 0);
    for(let i = 0; i < 1e7; i++){
        if(stackBVH.length == 0){ break; }
        let stack = stackBVH.pop();

        buildNode(stack.tris, stack.parent, stack.depth);
    }

    numNodes = nodesBVH.length;

    return compressBVH();
}

function surfaceArea(box){
    const b = [
        box[0][1] - box[0][0],
        box[1][1] - box[1][0],
        box[2][1] - box[2][0]
    ];
    return (b[0]*b[1] + b[1]*b[2] + b[2]*b[0]);
}



function buildNode(tris, parent, depth){
    if(parent >= 0){
        if(nodesBVH[parent].childa == 0){
            nodesBVH[parent].childa = nodesBVH.length;
        }else{
            nodesBVH[parent].childb = nodesBVH.length;
        }
    }

    const node = newNode();

    // for each point, get min and max
    let bounds = newAABB();
    for(let i = 0; i < tris.length; i ++){
        bounds = mmax(bounds, tris[i].mi, tris[i].ma);
    }

    if(tris.length < 2 + 0.25*depth || depth > MAX_DEPTH){
        node.start = trisBVH.length;
        node.len = tris.length;
        node.bounds = bounds;
        trisBVH.push(...tris);
        nodesBVH.push(node);
        return;
    }    
    

    let minCost = Infinity;
    let bestSplit = -1;
    let bestAxis = 0;

    for(let axis = 0; axis < 3; axis++){
        const minBound = bounds[axis][0];
        const maxBound = bounds[axis][1];
        const binSize = (maxBound - minBound) / NUM_BINS;

        for(let i = 0; i < NUM_BINS-1; i++){
            let left = 0;
            let right = 0;
            let leftBounds = newAABB();
            let rightBounds = newAABB();
            
            const compare = minBound + (i+1) * binSize;

            for(let j = 0; j < tris.length; j++){
                const center = tris[j].midpoint[axis];

                if(center < compare){
                    left++;
                    leftBounds = mmax(leftBounds, tris[j].mi, tris[j].ma);

                }else{
                    right++;
                    rightBounds = mmax(rightBounds, tris[j].mi, tris[j].ma);
                }
            }
            let SAHcost = 0;
            if(left == 0){
                SAHcost += 1e12;
            }else{
                SAHcost += left * surfaceArea(leftBounds);
            }
            if(right == 0){
                SAHcost += 1e12;
            }else{
                SAHcost += right * surfaceArea(rightBounds);
            }

            if(SAHcost < minCost /*&& (right > 0 && left > 0)*/){
                minCost = SAHcost;
                bestSplit = i;
                bestAxis = axis;
            }
        }
    }


    const minBound = bounds[bestAxis][0];
    const maxBound = bounds[bestAxis][1];
    const binSize = (maxBound - minBound) / NUM_BINS;
    let compare = minBound + (bestSplit + 1) * binSize;

    if(minCost > 1e9){
        // this code handles an edge case where triangles overlay and no good separating axis can be found
        for(let axis = 0; axis < 3; axis++){
            if(Math.abs(tris[0].midpoint[axis]-tris[1].midpoint[axis]) > 1e-6){
                bestAxis = axis;
                compare = (tris[0].midpoint[axis] + tris[1].midpoint[axis])*0.5;
                break;
            }
        }
    }

    const left = [];
    const right = [];

    for(let i = 0; i < tris.length; i++){
        const center = tris[i].midpoint[bestAxis];
        if(center < compare){
            left.push(tris[i]);
        }else{
            right.push(tris[i]);
        }
    }

    node.bounds = bounds;

    nodesBVH.push(node);
    if(left.length > 0){ pushToStack(left, nodesBVH.length-1, depth + 1); }
    if(right.length > 0){ pushToStack(right, nodesBVH.length-1, depth + 1); }

}


// function to pack the bvh data into more a gpu-friendly format
function compressBVH(){
    
    let t = [];
    let n = [];
    for(let tri of trisBVH){
        const v = tri.verts;
        for(let i = 0; i < 3; i++){
            t.push(
                ...v[i].pos, -1,
                ...v[i].uv, -1, -1,
                ...v[i].normal, -1
            );
        }
        t.push(tri.material, -1, -1, -1);
    }

    for(let node of nodesBVH){
        n.push(
            node.start, node.len, node.childa, node.childb,
            node.bounds[0][0], node.bounds[1][0], node.bounds[2][0], -1,
            node.bounds[0][1], node.bounds[1][1], node.bounds[2][1], -1
        );
    }

    return {tris: new Float32Array(t), nodes: new Float32Array(n)};
}