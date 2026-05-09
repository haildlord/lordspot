import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

export const CoinCanvas = () => {
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!mountRef.current) return;

        const scene = new THREE.Scene();
        scene.background = null;

        const width = mountRef.current.clientWidth;
        const height = mountRef.current.clientHeight;
        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200);

        camera.position.set(0, 0, 18);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        renderer.outputColorSpace = THREE.SRGBColorSpace;

        mountRef.current.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 0.5));

        const mainLight = new THREE.DirectionalLight(0xffffff, 1.8);
        mainLight.position.set(10, 10, 10);
        scene.add(mainLight);

        const fillLight = new THREE.DirectionalLight(0xffffff, 0.9);
        fillLight.position.set(-10, -10, -10);
        scene.add(fillLight);

        let coin: THREE.Mesh;
        let controls: OrbitControls;

        const loader = new THREE.TextureLoader();
        loader.load('/mock_lords_usdc.png', (texture) => {

            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 16;
            texture.center.set(0.5, 0.5);
            texture.repeat.set(0.83, 0.85);

            const edgeMaterial = new THREE.MeshStandardMaterial({
                color: 0xFFC000,
                metalness: 1.0,
                roughness: 0.35,
            });

            const frontMaterial = new THREE.MeshBasicMaterial({
                map: texture,
                color: 0xffffff,
            });

            const backTexture = texture.clone();
            backTexture.rotation = Math.PI;
            backTexture.needsUpdate = true;

            const backMaterial = new THREE.MeshBasicMaterial({
                map: backTexture,
                color: 0xffffff,
            });

            const geometry = new THREE.CylinderGeometry(4, 4, 0.3, 100);
            coin = new THREE.Mesh(geometry, [edgeMaterial, frontMaterial, backMaterial]);

            coin.rotation.z = Math.PI / 2;
            coin.rotation.y = Math.PI / 2;
            scene.add(coin);

            controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.12;
            controls.enablePan = false;

            controls.minDistance = 6;
            controls.maxDistance = 25;
            controls.minPolarAngle = Math.PI / 2 - 0.2;
            controls.maxPolarAngle = Math.PI / 2 + 0.2;

        });

        let animationFrameId: number;

        const animate = () => {
            animationFrameId = requestAnimationFrame(animate);

            if (coin) {
                const baseSpeed = 0.015;
                const pulse = Math.cos(coin.rotation.y * 2);
                const dynamicSpeed = baseSpeed * (1 + 0.7 * pulse);
                coin.rotation.y += dynamicSpeed;
            }
            if (controls) controls.update();
            renderer.render(scene, camera);
        };

        animate();

        const handleResize = () => {
            if (!mountRef.current) return;
            const newWidth = mountRef.current.clientWidth;
            const newHeight = mountRef.current.clientHeight;
            camera.aspect = newWidth / newHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(newWidth, newHeight);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animationFrameId);
            if (mountRef.current && renderer.domElement) {
                mountRef.current.removeChild(renderer.domElement);
            }
            renderer.dispose();
        };
    }, []);

    return (
        <div className="relative w-full h-full flex items-center justify-center">
            <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
        </div>
    );
};