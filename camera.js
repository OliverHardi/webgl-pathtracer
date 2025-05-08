// this file has the camera controller

const keys = {up: 0, down: 0, left: 0, right: 0, w: 0, a: 0, s: 0, d: 0, e: 0, q: 0};
let cam = {x: 0, y: 3, z: -5, dx: Math.PI*0.125, dy: Math.PI, dz: 0};

document.addEventListener('keydown', function(event) {
    switch(event.key) {
        case 'ArrowUp':
            keys.up = 1;
            break;
        case 'ArrowDown':
            keys.down = 1;
            break;
        case 'ArrowLeft':
            keys.left = 1;
            break;
        case 'ArrowRight':
            keys.right = 1;
            break;
        case 'w':
        case 'W':
            keys.w = 1;
            break;
        case 'a':
        case 'A':
            keys.a = 1;
            break;
        case 's':
        case 'S':
            keys.s = 1;
            break;
        case 'd':
        case 'D':
            keys.d = 1;
            break;
        case 'e':
        case 'E':
        case ' ':
            keys.e = 1;
            break;
        case 'q':
        case 'Q':
        case 'Shift':
            keys.q = 1;
            break;
    }
});

document.addEventListener('keyup', function(event) {
    switch(event.key) {
        case 'ArrowUp':
            keys.up = 0;
            break;
        case 'ArrowDown':
            keys.down = 0;
            break;
        case 'ArrowLeft':
            keys.left = 0;
            break;
        case 'ArrowRight':
            keys.right = 0;
            break;
        case 'w':
        case 'W':
            keys.w = 0;
            break;
        case 'a':
        case 'A':
            keys.a = 0;
            break;
        case 's':
        case 'S':
            keys.s = 0;
            break;
        case 'd':
        case 'D':
            keys.d = 0;
            break;
        case 'e':
        case 'E':
        case ' ':
            keys.e = 0;
            break;
        case 'q':
        case 'Q':
        case 'Shift':
            keys.q = 0;
            break;
    }
});

canvas.addEventListener('mousemove', function(event) {
    if(event.buttons == 1){
        resetFrame();
        cam.dy -= event.movementX * 0.25 * dt;
        cam.dx += event.movementY * 0.25 * dt;
    }
}
);

function moveCam(){
    if(isNaN(dt)){ dt = 0.1; }
    dt = 0.03;

    view = mat4.create();
    rot = mat4.create();

    cam.dx += (keys.down-keys.up)*2.*dt;
    if(cam.dx < Math.PI*-0.5){ cam.dx = Math.PI*-0.5; }
    if(cam.dx > Math.PI*0.5){ cam.dx = Math.PI*0.5; }
    cam.dy += (keys.left-keys.right)*2.*dt;
    mat4.rotateX(view, view, cam.dx);
    mat4.rotateY(view, view, cam.dy);

    
    const temp = mat2.create();
    mat2.fromRotation(temp, cam.dy);

    let forward = vec2.fromValues(0, (keys.s-keys.w)*3.*dt);
    let right = vec2.fromValues((keys.a-keys.d)*3.*dt, 0);

    vec2.transformMat2(forward, forward, temp);
    vec2.transformMat2(right, right, temp);

    cam.x += forward[0] + right[0];
    cam.y += (keys.e-keys.q)*3.*dt;
    cam.z += forward[1] + right[1];

    mat4.translate(view, view, [-cam.x, -cam.y, -cam.z]);
    mat4.translate(rot, rot, [cam.x, cam.y, cam.z]);

    mat4.rotateX(rot, rot, -cam.dx);
    mat4.rotateY(rot, rot, -cam.dy);

    if(Object.values(keys).some(value => value === 1)){
        resetFrame();
    }
}