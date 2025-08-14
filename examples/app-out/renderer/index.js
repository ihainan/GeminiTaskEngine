document.addEventListener('DOMContentLoaded', () => {
    const outputLog = document.getElementById('output-log');

    // Simulate output log content
    outputLog.value = "For Help, press F1";

    // Basic 3D scene setup (requires Three.js)
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('three-d-canvas') });
    renderer.setSize(window.innerWidth * 0.7, window.innerHeight * 0.7); // Adjust size for center pane

    // Create a simple woven structure (simulated)
    const material = new THREE.MeshBasicMaterial({ color: 0xFFA500 }); // Orange color

    const barWidth = 0.5;
    const barHeight = 0.5;
    const barDepth = 5;
    const spacing = 1;

    for (let i = 0; i < 15; i++) {
        for (let j = 0; j < 15; j++) {
            // Horizontal bars
            const horizontalGeometry = new THREE.BoxGeometry(barDepth, barHeight, barWidth);
            const horizontalBar = new THREE.Mesh(horizontalGeometry, material);
            horizontalBar.position.set(
                (j * (barDepth + spacing)) - (15 * (barDepth + spacing)) / 2,
                0,
                (i * (barWidth + spacing)) - (15 * (barWidth + spacing)) / 2
            );
            scene.add(horizontalBar);

            // Vertical bars
            const verticalGeometry = new THREE.BoxGeometry(barWidth, barHeight, barDepth);
            const verticalBar = new THREE.Mesh(verticalGeometry, material);
            verticalBar.position.set(
                (i * (barWidth + spacing)) - (15 * (barWidth + spacing)) / 2,
                0,
                (j * (barDepth + spacing)) - (15 * (barDepth + spacing)) / 2
            );
            scene.add(verticalBar);
        }
    }

    camera.position.z = 30;
    camera.position.y = 10;
    camera.rotation.x = -Math.PI / 6; // Tilt down slightly

    function animate() {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
    }
    animate();

    // Handle window resizing
    window.addEventListener('resize', () => {
        const newWidth = window.innerWidth * 0.7;
        const newHeight = window.innerHeight * 0.7;
        renderer.setSize(newWidth, newHeight);
        camera.aspect = newWidth / newHeight;
        camera.updateProjectionMatrix();
    });
});
