// public/map.js

// Importamos los servicios de Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    onSnapshot, 
    doc, 
    setDoc, 
    deleteDoc,
    query
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- Configuración de Firebase (debe coincidir con auth.js y seedData.js) ---
const firebaseConfig = {
    apiKey: "AIzaSyDMiEPfaORxI8ug99GBws3B2yyBAe8Mc3w",
    authDomain: "ecogestor-ff912.firebaseapp.com",
    projectId: "ecogestor-ff912",
    storageBucket: "ecogestor-ff912.firebasestorage.app",
    messagingSenderId: "258191735567",
    appId: "1:258191735567:web:e79a3f3a4fdce8c6135c7a",
    measurementId: "G-WR1B73V7Y4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Variables Globales ---
let map;
let recyclingPoints = [];
let markersLayer = L.layerGroup();
let currentUserId = null;
let favoritePointIds = new Set(); 

// --- Elementos de la UI ---
const filterControls = document.getElementById('filter-controls');
const favoritesList = document.getElementById('favorites-list');

// --- 1. Inicialización del Mapa ---
function initializeMap() {
    // Coordenadas iniciales centradas en Santiago, Chile
    const santiagoCoords = [-33.4489, -70.6693]; 

    if (map) {
        map.remove(); // Evita re-inicializar si ya existe
    }

    map = L.map('map').setView(santiagoCoords, 12); // Nivel de zoom 12

    // Capa de mosaicos (Tile Layer) de OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    markersLayer.addTo(map);
}

// --- 2. Lectura y Muestra de Puntos de Reciclaje (Firestore) ---
function loadRecyclingPoints() {
    console.log("Cargando Puntos de Reciclaje desde Firestore...");
    const pointsRef = collection(db, "puntos_reciclaje");
    
    // onSnapshot mantiene una conexión en tiempo real con la base de datos
    onSnapshot(pointsRef, (snapshot) => {
        recyclingPoints = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        // Regenerar la UI (Filtros y Mapa)
        renderFilters();
        renderPointsOnMap();
    }, (error) => {
        console.error("Error al cargar puntos de reciclaje:", error);
    });
}

// --- 3. Lógica de Favoritos (Lectura en tiempo real) ---

function setupFavoritesListener(userId) {
    if (!userId) return;

    // La colección 'favoritos' se organiza por el ID del usuario
    const favoritesRef = collection(db, `favoritos/${userId}/puntos`);

    onSnapshot(favoritesRef, (snapshot) => {
        favoritePointIds = new Set(snapshot.docs.map(doc => doc.id));
        renderFavoritesList();
        renderPointsOnMap(); // Actualiza los marcadores para mostrar el estado de favorito
    }, (error) => {
        console.error("Error al cargar favoritos:", error);
    });
}

async function toggleFavorite(pointId, isFavorite) {
    if (!currentUserId) {
        alert("Debes iniciar sesión para agregar favoritos.");
        return;
    }
    
    // Referencia al documento de favorito específico del usuario
    const favoriteDocRef = doc(db, `favoritos/${currentUserId}/puntos/${pointId}`);

    try {
        if (isFavorite) {
            // Eliminar favorito
            await deleteDoc(favoriteDocRef);
            console.log(`Punto ${pointId} eliminado de favoritos.`);
        } else {
            // Agregar favorito (el nombre del documento es el ID del punto)
            await setDoc(favoriteDocRef, {
                agregado: new Date().toISOString()
            });
            console.log(`Punto ${pointId} agregado a favoritos.`);
        }
    } catch (e) {
        console.error("Error al modificar favorito:", e);
        alert("Hubo un error al actualizar los favoritos.");
    }
}

// --- 4. Renderizado y Filtros ---

// Identifica todos los materiales únicos para crear los checkboxes
function getAllMaterials() {
    const materials = new Set();
    recyclingPoints.forEach(p => p.materiales.forEach(m => materials.add(m)));
    return Array.from(materials).sort();
}

// Renderiza los filtros
function renderFilters() {
    const materials = getAllMaterials();
    filterControls.innerHTML = '';
    
    materials.forEach(material => {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = `filter-${material.replace(/\s/g, '-')}`;
        input.value = material;
        input.className = 'mr-2 accent-green-600';
        input.addEventListener('change', renderPointsOnMap);

        const label = document.createElement('label');
        label.htmlFor = input.id;
        label.textContent = material;
        label.className = 'text-gray-600 cursor-pointer';

        const div = document.createElement('div');
        div.appendChild(input);
        div.appendChild(label);
        filterControls.appendChild(div);
    });
}

// Obtiene los filtros activos
function getActiveFilters() {
    const activeFilters = new Set();
    filterControls.querySelectorAll('input:checked').forEach(input => {
        activeFilters.add(input.value);
    });
    return activeFilters;
}

// Renderiza los puntos en el mapa
function renderPointsOnMap() {
    markersLayer.clearLayers();
    const activeFilters = getActiveFilters();

    recyclingPoints.forEach(point => {
        // Lógica de filtrado: si no hay filtros o si el punto contiene algún material activo
        const isVisible = activeFilters.size === 0 || 
                          point.materiales.some(m => activeFilters.has(m));
                          
        if (isVisible) {
            const isFavorite = favoritePointIds.has(point.id);
            const iconUrl = isFavorite ? 
                            'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png' : 
                            'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png';

            const customIcon = L.icon({
                iconUrl: iconUrl,
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34]
            });

            const marker = L.marker([point.latitud, point.longitud], { icon: customIcon }).addTo(markersLayer);

            // Contenido del Popup (con botón de Favorito)
            const popupContent = `
                <div class="p-2">
                    <h3 class="font-bold text-green-700">${point.nombre}</h3>
                    <p class="text-sm">Comuna: ${point.comuna}</p>
                    <p class="text-xs">Horario: ${point.horario}</p>
                    <p class="mt-2 font-semibold">Materiales:</p>
                    <ul class="list-disc ml-4 text-xs">
                        ${point.materiales.map(m => `<li>${m}</li>`).join('')}
                    </ul>
                    <button id="fav-btn-${point.id}" 
                            class="mt-3 w-full p-2 text-xs rounded-lg text-white font-bold 
                            ${isFavorite ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}">
                        ${isFavorite ? '🗑️ Quitar de Favoritos' : '⭐ Agregar a Favoritos'}
                    </button>
                </div>
            `;
            
            marker.bindPopup(popupContent);

            // Añadir el listener al botón cuando el popup se abre
            marker.on('popupopen', () => {
                const favBtn = document.getElementById(`fav-btn-${point.id}`);
                if (favBtn) {
                    favBtn.onclick = () => {
                        toggleFavorite(point.id, isFavorite);
                    };
                }
            });
        }
    });
}

// Renderiza la lista lateral de favoritos
function renderFavoritesList() {
    favoritesList.innerHTML = '';
    if (favoritePointIds.size === 0) {
        favoritesList.innerHTML = `<li class="text-gray-500">No tienes puntos favoritos.</li>`;
        return;
    }
    
    // Filtramos los puntos para obtener solo los favoritos
    const favorites = recyclingPoints.filter(p => favoritePointIds.has(p.id));

    favorites.forEach(point => {
        const li = document.createElement('li');
        li.className = 'p-3 bg-gray-100 rounded-lg flex justify-between items-center hover:bg-gray-200 transition duration-150';
        li.innerHTML = `
            <div>
                <span class="font-semibold text-gray-700">${point.nombre}</span><br>
                <span class="text-xs text-gray-500">${point.comuna}</span>
            </div>
            <button data-id="${point.id}" class="remove-fav-btn text-red-500 hover:text-red-700 text-lg">🗑️</button>
        `;
        favoritesList.appendChild(li);
    });

    // Añadir listeners para quitar favoritos de la lista
    favoritesList.querySelectorAll('.remove-fav-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const pointId = e.currentTarget.getAttribute('data-id');
            toggleFavorite(pointId, true); // true = isFavorite, por lo tanto, lo elimina
        });
    });
}

// --- 5. Manejo del Estado de Autenticación y Carga ---

onAuthStateChanged(auth, (user) => {
    const authUI = document.getElementById('auth-ui');
    const mainAppUI = document.getElementById('main-app-ui');
    const userDisplay = document.getElementById('user-display');
    
    if (user) {
        // Usuario logueado: Muestra la app principal
        currentUserId = user.uid;
        authUI.classList.add('hidden');
        mainAppUI.classList.remove('hidden');
        userDisplay.textContent = `Usuario: ${user.email}`;

        // Inicializa el mapa y carga los datos
        initializeMap();
        loadRecyclingPoints();
        setupFavoritesListener(user.uid); // Comienza a escuchar los favoritos del usuario
        
    } else {
        // Usuario deslogueado: Muestra la pantalla de login
        currentUserId = null;
        favoritePointIds = new Set();
        authUI.classList.remove('hidden');
        mainAppUI.classList.add('hidden');
        // Limpiamos los listeners o el mapa si es necesario (el auth.js ya maneja esto)
    }
});