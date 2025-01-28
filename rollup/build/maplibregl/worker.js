define(['./shared'], function (performance) { 'use strict';

function stringify(obj) {
    var type = typeof obj;
    if (type === 'number' || type === 'boolean' || type === 'string' || obj === undefined || obj === null) {
        return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
        var str$1 = '[';
        for (var i$1 = 0, list = obj; i$1 < list.length; i$1 += 1) {
            var val = list[i$1];
            str$1 += stringify(val) + ',';
        }
        return str$1 + ']';
    }
    var keys = Object.keys(obj).sort();
    var str = '{';
    for (var i = 0; i < keys.length; i++) {
        str += JSON.stringify(keys[i]) + ':' + stringify(obj[keys[i]]) + ',';
    }
    return str + '}';
}
function getKey(layer) {
    var key = '';
    for (var i = 0, list = performance.refProperties; i < list.length; i += 1) {
        var k = list[i];
        key += '/' + stringify(layer[k]);
    }
    return key;
}
function groupByLayout(layers, cachedKeys) {
    var groups = {};
    for (var i = 0; i < layers.length; i++) {
        var k = cachedKeys && cachedKeys[layers[i].id] || getKey(layers[i]);
        if (cachedKeys) {
            cachedKeys[layers[i].id] = k;
        }
        var group = groups[k];
        if (!group) {
            group = groups[k] = [];
        }
        group.push(layers[i]);
    }
    var result = [];
    for (var k$1 in groups) {
        result.push(groups[k$1]);
    }
    return result;
}

var StyleLayerIndex = function StyleLayerIndex(layerConfigs) {
    this.keyCache = {};
    if (layerConfigs) {
        this.replace(layerConfigs);
    }
};
StyleLayerIndex.prototype.replace = function replace(layerConfigs) {
    this._layerConfigs = {};
    this._layers = {};
    this.update(layerConfigs, []);
};
StyleLayerIndex.prototype.update = function update(layerConfigs, removedIds) {
    var this$1 = this;
    for (var i = 0, list = layerConfigs; i < list.length; i += 1) {
        var layerConfig = list[i];
        this._layerConfigs[layerConfig.id] = layerConfig;
        var layer = this._layers[layerConfig.id] = performance.createStyleLayer(layerConfig);
        layer._featureFilter = performance.featureFilter(layer.filter);
        if (this.keyCache[layerConfig.id]) {
            delete this.keyCache[layerConfig.id];
        }
    }
    for (var i$1 = 0, list$1 = removedIds; i$1 < list$1.length; i$1 += 1) {
        var id = list$1[i$1];
        delete this.keyCache[id];
        delete this._layerConfigs[id];
        delete this._layers[id];
    }
    this.familiesBySource = {};
    var groups = groupByLayout(performance.values(this._layerConfigs), this.keyCache);
    for (var i$2 = 0, list$2 = groups; i$2 < list$2.length; i$2 += 1) {
        var layerConfigs$1 = list$2[i$2];
        var layers = layerConfigs$1.map(function (layerConfig) {
            return this$1._layers[layerConfig.id];
        });
        var layer$1 = layers[0];
        if (layer$1.visibility === 'none') {
            continue;
        }
        var sourceId = layer$1.source || '';
        var sourceGroup = this.familiesBySource[sourceId];
        if (!sourceGroup) {
            sourceGroup = this.familiesBySource[sourceId] = {};
        }
        var sourceLayerId = layer$1.sourceLayer || '_geojsonTileLayer';
        var sourceLayerFamilies = sourceGroup[sourceLayerId];
        if (!sourceLayerFamilies) {
            sourceLayerFamilies = sourceGroup[sourceLayerId] = [];
        }
        sourceLayerFamilies.push(layers);
    }
};

var padding = 1;
var GlyphAtlas = function GlyphAtlas(stacks) {
    var positions = {};
    var bins = [];
    for (var stack in stacks) {
        var glyphs = stacks[stack];
        var stackPositions = positions[stack] = {};
        for (var id in glyphs) {
            var src = glyphs[+id];
            if (!src || src.bitmap.width === 0 || src.bitmap.height === 0) {
                continue;
            }
            var bin = {
                x: 0,
                y: 0,
                w: src.bitmap.width + 2 * padding,
                h: src.bitmap.height + 2 * padding
            };
            bins.push(bin);
            stackPositions[id] = {
                rect: bin,
                metrics: src.metrics
            };
        }
    }
    var ref = performance.potpack(bins);
    var w = ref.w;
    var h = ref.h;
    var image = new performance.AlphaImage({
        width: w || 1,
        height: h || 1
    });
    for (var stack$1 in stacks) {
        var glyphs$1 = stacks[stack$1];
        for (var id$1 in glyphs$1) {
            var src$1 = glyphs$1[+id$1];
            if (!src$1 || src$1.bitmap.width === 0 || src$1.bitmap.height === 0) {
                continue;
            }
            var bin$1 = positions[stack$1][id$1].rect;
            performance.AlphaImage.copy(src$1.bitmap, image, {
                x: 0,
                y: 0
            }, {
                x: bin$1.x + padding,
                y: bin$1.y + padding
            }, src$1.bitmap);
        }
    }
    this.image = image;
    this.positions = positions;
};
performance.register('GlyphAtlas', GlyphAtlas);

var WorkerTile = function WorkerTile(params) {
    this.tileID = new performance.OverscaledTileID(params.tileID.overscaledZ, params.tileID.wrap, params.tileID.canonical.z, params.tileID.canonical.x, params.tileID.canonical.y);
    this.uid = params.uid;
    this.zoom = params.zoom;
    this.pixelRatio = params.pixelRatio;
    this.tileSize = params.tileSize;
    this.source = params.source;
    this.overscaling = this.tileID.overscaleFactor();
    this.showCollisionBoxes = params.showCollisionBoxes;
    this.collectResourceTiming = !!params.collectResourceTiming;
    this.returnDependencies = !!params.returnDependencies;
    this.promoteId = params.promoteId;
};
WorkerTile.prototype.parse = function parse(data, layerIndex, availableImages, actor, callback) {
    var this$1 = this;
    this.status = 'parsing';
    this.data = data;
    this.collisionBoxArray = new performance.CollisionBoxArray();
    var sourceLayerCoder = new performance.DictionaryCoder(Object.keys(data.layers).sort());
    var featureIndex = new performance.FeatureIndex(this.tileID, this.promoteId);
    featureIndex.bucketLayerIDs = [];
    var buckets = {};
    var options = {
        featureIndex: featureIndex,
        iconDependencies: {},
        patternDependencies: {},
        glyphDependencies: {},
        availableImages: availableImages
    };
    var layerFamilies = layerIndex.familiesBySource[this.source];
    for (var sourceLayerId in layerFamilies) {
        var sourceLayer = data.layers[sourceLayerId];
        if (!sourceLayer) {
            continue;
        }
        if (sourceLayer.version === 1) {
            performance.warnOnce('Vector tile source "' + this.source + '" layer "' + sourceLayerId + '" ' + 'does not use vector tile spec v2 and therefore may have some rendering errors.');
        }
        var sourceLayerIndex = sourceLayerCoder.encode(sourceLayerId);
        var features = [];
        for (var index = 0; index < sourceLayer.length; index++) {
            var feature = sourceLayer.feature(index);
            var id = featureIndex.getId(feature, sourceLayerId);
            features.push({
                feature: feature,
                id: id,
                index: index,
                sourceLayerIndex: sourceLayerIndex
            });
        }
        for (var i = 0, list = layerFamilies[sourceLayerId]; i < list.length; i += 1) {
            var family = list[i];
            var layer = family[0];
            if (layer.minzoom && this.zoom < Math.floor(layer.minzoom)) {
                continue;
            }
            if (layer.maxzoom && this.zoom >= layer.maxzoom) {
                continue;
            }
            if (layer.visibility === 'none') {
                continue;
            }
            recalculateLayers(family, this.zoom, availableImages);
            var bucket = buckets[layer.id] = layer.createBucket({
                index: featureIndex.bucketLayerIDs.length,
                layers: family,
                zoom: this.zoom,
                pixelRatio: this.pixelRatio,
                overscaling: this.overscaling,
                collisionBoxArray: this.collisionBoxArray,
                sourceLayerIndex: sourceLayerIndex,
                sourceID: this.source
            });
            bucket.populate(features, options, this.tileID.canonical);
            featureIndex.bucketLayerIDs.push(family.map(function (l) {
                return l.id;
            }));
        }
    }
    var error;
    var glyphMap;
    var iconMap;
    var patternMap;
    var stacks = performance.mapObject(options.glyphDependencies, function (glyphs) {
        return Object.keys(glyphs).map(Number);
    });
    if (Object.keys(stacks).length) {
        actor.send('getGlyphs', {
            uid: this.uid,
            stacks: stacks
        }, function (err, result) {
            if (!error) {
                error = err;
                glyphMap = result;
                maybePrepare.call(this$1);
            }
        });
    } else {
        glyphMap = {};
    }
    var icons = Object.keys(options.iconDependencies);
    if (icons.length) {
        actor.send('getImages', {
            icons: icons,
            source: this.source,
            tileID: this.tileID,
            type: 'icons'
        }, function (err, result) {
            if (!error) {
                error = err;
                iconMap = result;
                maybePrepare.call(this$1);
            }
        });
    } else {
        iconMap = {};
    }
    var patterns = Object.keys(options.patternDependencies);
    if (patterns.length) {
        actor.send('getImages', {
            icons: patterns,
            source: this.source,
            tileID: this.tileID,
            type: 'patterns'
        }, function (err, result) {
            if (!error) {
                error = err;
                patternMap = result;
                maybePrepare.call(this$1);
            }
        });
    } else {
        patternMap = {};
    }
    maybePrepare.call(this);
    function maybePrepare() {
        if (error) {
            return callback(error);
        } else if (glyphMap && iconMap && patternMap) {
            var glyphAtlas = new GlyphAtlas(glyphMap);
            var imageAtlas = new performance.ImageAtlas(iconMap, patternMap);
            for (var key in buckets) {
                var bucket = buckets[key];
                if (bucket instanceof performance.SymbolBucket) {
                    recalculateLayers(bucket.layers, this.zoom, availableImages);
                    performance.performSymbolLayout(bucket, glyphMap, glyphAtlas.positions, iconMap, imageAtlas.iconPositions, this.showCollisionBoxes, this.tileID.canonical);
                } else if (bucket.hasPattern && (bucket instanceof performance.LineBucket || bucket instanceof performance.FillBucket || bucket instanceof performance.FillExtrusionBucket)) {
                    recalculateLayers(bucket.layers, this.zoom, availableImages);
                    bucket.addFeatures(options, this.tileID.canonical, imageAtlas.patternPositions);
                }
            }
            this.status = 'done';
            callback(null, {
                buckets: performance.values(buckets).filter(function (b) {
                    return !b.isEmpty();
                }),
                featureIndex: featureIndex,
                collisionBoxArray: this.collisionBoxArray,
                glyphAtlasImage: glyphAtlas.image,
                imageAtlas: imageAtlas,
                glyphMap: this.returnDependencies ? glyphMap : null,
                iconMap: this.returnDependencies ? iconMap : null,
                glyphPositions: this.returnDependencies ? glyphAtlas.positions : null
            });
        }
    }
};
function recalculateLayers(layers, zoom, availableImages) {
    var parameters = new performance.EvaluationParameters(zoom);
    for (var i = 0, list = layers; i < list.length; i += 1) {
        var layer = list[i];
        layer.recalculate(parameters, availableImages);
    }
}

function loadVectorTile(params, callback) {
    var request = performance.getArrayBuffer(params.request, function (err, data, cacheControl, expires) {
        if (err) {
            callback(err);
        } else if (data) {
            callback(null, {
                vectorTile: new performance.vectorTile.VectorTile(new performance.pbf(data)),
                rawData: data,
                cacheControl: cacheControl,
                expires: expires
            });
        }
    });
    return function () {
        request.cancel();
        callback();
    };
}
var VectorTileWorkerSource = function VectorTileWorkerSource(actor, layerIndex, availableImages, loadVectorData) {
    this.actor = actor;
    this.layerIndex = layerIndex;
    this.availableImages = availableImages;
    this.loadVectorData = loadVectorData || loadVectorTile;
    this.loading = {};
    this.loaded = {};
};
VectorTileWorkerSource.prototype.loadTile = function loadTile(params, callback) {
    var this$1 = this;
    var uid = params.uid;
    if (!this.loading) {
        this.loading = {};
    }
    var perf = params && params.request && params.request.collectResourceTiming ? new performance.RequestPerformance(params.request) : false;
    var workerTile = this.loading[uid] = new WorkerTile(params);
    workerTile.abort = this.loadVectorData(params, function (err, response) {
        delete this$1.loading[uid];
        if (err || !response) {
            workerTile.status = 'done';
            this$1.loaded[uid] = workerTile;
            return callback(err);
        }
        var rawTileData = response.rawData;
        var cacheControl = {};
        if (response.expires) {
            cacheControl.expires = response.expires;
        }
        if (response.cacheControl) {
            cacheControl.cacheControl = response.cacheControl;
        }
        var resourceTiming = {};
        if (perf) {
            var resourceTimingData = perf.finish();
            if (resourceTimingData) {
                resourceTiming.resourceTiming = JSON.parse(JSON.stringify(resourceTimingData));
            }
        }
        workerTile.vectorTile = response.vectorTile;
        workerTile.parse(response.vectorTile, this$1.layerIndex, this$1.availableImages, this$1.actor, function (err, result) {
            if (err || !result) {
                return callback(err);
            }
            callback(null, performance.extend({ rawTileData: rawTileData.slice(0) }, result, cacheControl, resourceTiming));
        });
        this$1.loaded = this$1.loaded || {};
        this$1.loaded[uid] = workerTile;
    });
};
VectorTileWorkerSource.prototype.reloadTile = function reloadTile(params, callback) {
    var this$1 = this;
    var loaded = this.loaded, uid = params.uid, vtSource = this;
    if (loaded && loaded[uid]) {
        var workerTile = loaded[uid];
        workerTile.showCollisionBoxes = params.showCollisionBoxes;
        var done = function (err, data) {
            var reloadCallback = workerTile.reloadCallback;
            if (reloadCallback) {
                delete workerTile.reloadCallback;
                workerTile.parse(workerTile.vectorTile, vtSource.layerIndex, this$1.availableImages, vtSource.actor, reloadCallback);
            }
            callback(err, data);
        };
        if (workerTile.status === 'parsing') {
            workerTile.reloadCallback = done;
        } else if (workerTile.status === 'done') {
            if (workerTile.vectorTile) {
                workerTile.parse(workerTile.vectorTile, this.layerIndex, this.availableImages, this.actor, done);
            } else {
                done();
            }
        }
    }
};
VectorTileWorkerSource.prototype.abortTile = function abortTile(params, callback) {
    var loading = this.loading, uid = params.uid;
    if (loading && loading[uid] && loading[uid].abort) {
        loading[uid].abort();
        delete loading[uid];
    }
    callback();
};
VectorTileWorkerSource.prototype.removeTile = function removeTile(params, callback) {
    var loaded = this.loaded, uid = params.uid;
    if (loaded && loaded[uid]) {
        delete loaded[uid];
    }
    callback();
};

var ImageBitmap = performance.window.ImageBitmap;
var RasterDEMTileWorkerSource = function RasterDEMTileWorkerSource() {
    this.loaded = {};
};
RasterDEMTileWorkerSource.prototype.loadTile = function loadTile(params, callback) {
    var uid = params.uid;
    var encoding = params.encoding;
    var rawImageData = params.rawImageData;
    var imagePixels = ImageBitmap && rawImageData instanceof ImageBitmap ? this.getImageData(rawImageData) : rawImageData;
    var dem = new performance.DEMData(uid, imagePixels, encoding);
    this.loaded = this.loaded || {};
    this.loaded[uid] = dem;
    callback(null, dem);
};
RasterDEMTileWorkerSource.prototype.getImageData = function getImageData(imgBitmap) {
    if (!this.offscreenCanvas || !this.offscreenCanvasContext) {
        this.offscreenCanvas = new OffscreenCanvas(imgBitmap.width, imgBitmap.height);
        this.offscreenCanvasContext = this.offscreenCanvas.getContext('2d');
    }
    this.offscreenCanvas.width = imgBitmap.width;
    this.offscreenCanvas.height = imgBitmap.height;
    this.offscreenCanvasContext.drawImage(imgBitmap, 0, 0, imgBitmap.width, imgBitmap.height);
    var imgData = this.offscreenCanvasContext.getImageData(-1, -1, imgBitmap.width + 2, imgBitmap.height + 2);
    this.offscreenCanvasContext.clearRect(0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height);
    return new performance.RGBAImage({
        width: imgData.width,
        height: imgData.height
    }, imgData.data);
};
RasterDEMTileWorkerSource.prototype.removeTile = function removeTile(params) {
    var loaded = this.loaded, uid = params.uid;
    if (loaded && loaded[uid]) {
        delete loaded[uid];
    }
};

var geojsonRewind = rewind;
function rewind(gj, outer) {
    var type = gj && gj.type, i;
    if (type === 'FeatureCollection') {
        for (i = 0; i < gj.features.length; i++) {
            rewind(gj.features[i], outer);
        }
    } else if (type === 'GeometryCollection') {
        for (i = 0; i < gj.geometries.length; i++) {
            rewind(gj.geometries[i], outer);
        }
    } else if (type === 'Feature') {
        rewind(gj.geometry, outer);
    } else if (type === 'Polygon') {
        rewindRings(gj.coordinates, outer);
    } else if (type === 'MultiPolygon') {
        for (i = 0; i < gj.coordinates.length; i++) {
            rewindRings(gj.coordinates[i], outer);
        }
    }
    return gj;
}
function rewindRings(rings, outer) {
    if (rings.length === 0) {
        return;
    }
    rewindRing(rings[0], outer);
    for (var i = 1; i < rings.length; i++) {
        rewindRing(rings[i], !outer);
    }
}
function rewindRing(ring, dir) {
    var area = 0, err = 0;
    for (var i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
        var k = (ring[i][0] - ring[j][0]) * (ring[j][1] + ring[i][1]);
        var m = area + k;
        err += Math.abs(area) >= Math.abs(k) ? area - m + k : k - m + area;
        area = m;
    }
    if (area + err >= 0 !== !!dir) {
        ring.reverse();
    }
}

var toGeoJSON = performance.vectorTile.VectorTileFeature.prototype.toGeoJSON;
var FeatureWrapper = function FeatureWrapper(feature) {
    this._feature = feature;
    this.extent = performance.EXTENT;
    this.type = feature.type;
    this.properties = feature.tags;
    if ('id' in feature && !isNaN(feature.id)) {
        this.id = parseInt(feature.id, 10);
    }
};
FeatureWrapper.prototype.loadGeometry = function loadGeometry() {
    if (this._feature.type === 1) {
        var geometry = [];
        for (var i = 0, list = this._feature.geometry; i < list.length; i += 1) {
            var point = list[i];
            geometry.push([new performance.Point$1(point[0], point[1])]);
        }
        return geometry;
    } else {
        var geometry$1 = [];
        for (var i$2 = 0, list$2 = this._feature.geometry; i$2 < list$2.length; i$2 += 1) {
            var ring = list$2[i$2];
            var newRing = [];
            for (var i$1 = 0, list$1 = ring; i$1 < list$1.length; i$1 += 1) {
                var point$1 = list$1[i$1];
                newRing.push(new performance.Point$1(point$1[0], point$1[1]));
            }
            geometry$1.push(newRing);
        }
        return geometry$1;
    }
};
FeatureWrapper.prototype.toGeoJSON = function toGeoJSON$1(x, y, z) {
    return toGeoJSON.call(this, x, y, z);
};
var GeoJSONWrapper = function GeoJSONWrapper(features) {
    this.layers = { '_geojsonTileLayer': this };
    this.name = '_geojsonTileLayer';
    this.extent = performance.EXTENT;
    this.length = features.length;
    this._features = features;
};
GeoJSONWrapper.prototype.feature = function feature(i) {
    return new FeatureWrapper(this._features[i]);
};

var VectorTileFeature = performance.vectorTile.VectorTileFeature;
var geojson_wrapper = GeoJSONWrapper$1;
function GeoJSONWrapper$1(features, options) {
    this.options = options || {};
    this.features = features;
    this.length = features.length;
}
GeoJSONWrapper$1.prototype.feature = function (i) {
    return new FeatureWrapper$1(this.features[i], this.options.extent);
};
function FeatureWrapper$1(feature, extent) {
    this.id = typeof feature.id === 'number' ? feature.id : undefined;
    this.type = feature.type;
    this.rawGeometry = feature.type === 1 ? [feature.geometry] : feature.geometry;
    this.properties = feature.tags;
    this.extent = extent || 4096;
}
FeatureWrapper$1.prototype.loadGeometry = function () {
    var rings = this.rawGeometry;
    this.geometry = [];
    for (var i = 0; i < rings.length; i++) {
        var ring = rings[i];
        var newRing = [];
        for (var j = 0; j < ring.length; j++) {
            newRing.push(new performance.Point$1(ring[j][0], ring[j][1]));
        }
        this.geometry.push(newRing);
    }
    return this.geometry;
};
FeatureWrapper$1.prototype.bbox = function () {
    if (!this.geometry) {
        this.loadGeometry();
    }
    var rings = this.geometry;
    var x1 = Infinity;
    var x2 = -Infinity;
    var y1 = Infinity;
    var y2 = -Infinity;
    for (var i = 0; i < rings.length; i++) {
        var ring = rings[i];
        for (var j = 0; j < ring.length; j++) {
            var coord = ring[j];
            x1 = Math.min(x1, coord.x);
            x2 = Math.max(x2, coord.x);
            y1 = Math.min(y1, coord.y);
            y2 = Math.max(y2, coord.y);
        }
    }
    return [
        x1,
        y1,
        x2,
        y2
    ];
};
FeatureWrapper$1.prototype.toGeoJSON = VectorTileFeature.prototype.toGeoJSON;

var vtPbf = fromVectorTileJs;
var fromVectorTileJs_1 = fromVectorTileJs;
var fromGeojsonVt_1 = fromGeojsonVt;
var GeoJSONWrapper_1 = geojson_wrapper;
function fromVectorTileJs(tile) {
    var out = new performance.pbf();
    writeTile(tile, out);
    return out.finish();
}
function fromGeojsonVt(layers, options) {
    options = options || {};
    var l = {};
    for (var k in layers) {
        l[k] = new geojson_wrapper(layers[k].features, options);
        l[k].name = k;
        l[k].version = options.version;
        l[k].extent = options.extent;
    }
    return fromVectorTileJs({ layers: l });
}
function writeTile(tile, pbf) {
    for (var key in tile.layers) {
        pbf.writeMessage(3, writeLayer, tile.layers[key]);
    }
}
function writeLayer(layer, pbf) {
    pbf.writeVarintField(15, layer.version || 1);
    pbf.writeStringField(1, layer.name || '');
    pbf.writeVarintField(5, layer.extent || 4096);
    var i;
    var context = {
        keys: [],
        values: [],
        keycache: {},
        valuecache: {}
    };
    for (i = 0; i < layer.length; i++) {
        context.feature = layer.feature(i);
        pbf.writeMessage(2, writeFeature, context);
    }
    var keys = context.keys;
    for (i = 0; i < keys.length; i++) {
        pbf.writeStringField(3, keys[i]);
    }
    var values = context.values;
    for (i = 0; i < values.length; i++) {
        pbf.writeMessage(4, writeValue, values[i]);
    }
}
function writeFeature(context, pbf) {
    var feature = context.feature;
    if (feature.id !== undefined) {
        pbf.writeVarintField(1, feature.id);
    }
    pbf.writeMessage(2, writeProperties, context);
    pbf.writeVarintField(3, feature.type);
    pbf.writeMessage(4, writeGeometry, feature);
}
function writeProperties(context, pbf) {
    var feature = context.feature;
    var keys = context.keys;
    var values = context.values;
    var keycache = context.keycache;
    var valuecache = context.valuecache;
    for (var key in feature.properties) {
        var value = feature.properties[key];
        var keyIndex = keycache[key];
        if (value === null) {
            continue;
        }
        if (typeof keyIndex === 'undefined') {
            keys.push(key);
            keyIndex = keys.length - 1;
            keycache[key] = keyIndex;
        }
        pbf.writeVarint(keyIndex);
        var type = typeof value;
        if (type !== 'string' && type !== 'boolean' && type !== 'number') {
            value = JSON.stringify(value);
        }
        var valueKey = type + ':' + value;
        var valueIndex = valuecache[valueKey];
        if (typeof valueIndex === 'undefined') {
            values.push(value);
            valueIndex = values.length - 1;
            valuecache[valueKey] = valueIndex;
        }
        pbf.writeVarint(valueIndex);
    }
}
function command(cmd, length) {
    return (length << 3) + (cmd & 7);
}
function zigzag(num) {
    return num << 1 ^ num >> 31;
}
function writeGeometry(feature, pbf) {
    var geometry = feature.loadGeometry();
    var type = feature.type;
    var x = 0;
    var y = 0;
    var rings = geometry.length;
    for (var r = 0; r < rings; r++) {
        var ring = geometry[r];
        var count = 1;
        if (type === 1) {
            count = ring.length;
        }
        pbf.writeVarint(command(1, count));
        var lineCount = type === 3 ? ring.length - 1 : ring.length;
        for (var i = 0; i < lineCount; i++) {
            if (i === 1 && type !== 1) {
                pbf.writeVarint(command(2, lineCount - 1));
            }
            var dx = ring[i].x - x;
            var dy = ring[i].y - y;
            pbf.writeVarint(zigzag(dx));
            pbf.writeVarint(zigzag(dy));
            x += dx;
            y += dy;
        }
        if (type === 3) {
            pbf.writeVarint(command(7, 1));
        }
    }
}
function writeValue(value, pbf) {
    var type = typeof value;
    if (type === 'string') {
        pbf.writeStringField(1, value);
    } else if (type === 'boolean') {
        pbf.writeBooleanField(7, value);
    } else if (type === 'number') {
        if (value % 1 !== 0) {
            pbf.writeDoubleField(3, value);
        } else if (value < 0) {
            pbf.writeSVarintField(6, value);
        } else {
            pbf.writeVarintField(5, value);
        }
    }
}
vtPbf.fromVectorTileJs = fromVectorTileJs_1;
vtPbf.fromGeojsonVt = fromGeojsonVt_1;
vtPbf.GeoJSONWrapper = GeoJSONWrapper_1;

function sortKD(ids, coords, nodeSize, left, right, depth) {
    if (right - left <= nodeSize) {
        return;
    }
    var m = left + right >> 1;
    select(ids, coords, m, left, right, depth % 2);
    sortKD(ids, coords, nodeSize, left, m - 1, depth + 1);
    sortKD(ids, coords, nodeSize, m + 1, right, depth + 1);
}
function select(ids, coords, k, left, right, inc) {
    while (right > left) {
        if (right - left > 600) {
            var n = right - left + 1;
            var m = k - left + 1;
            var z = Math.log(n);
            var s = 0.5 * Math.exp(2 * z / 3);
            var sd = 0.5 * Math.sqrt(z * s * (n - s) / n) * (m - n / 2 < 0 ? -1 : 1);
            var newLeft = Math.max(left, Math.floor(k - m * s / n + sd));
            var newRight = Math.min(right, Math.floor(k + (n - m) * s / n + sd));
            select(ids, coords, k, newLeft, newRight, inc);
        }
        var t = coords[2 * k + inc];
        var i = left;
        var j = right;
        swapItem(ids, coords, left, k);
        if (coords[2 * right + inc] > t) {
            swapItem(ids, coords, left, right);
        }
        while (i < j) {
            swapItem(ids, coords, i, j);
            i++;
            j--;
            while (coords[2 * i + inc] < t) {
                i++;
            }
            while (coords[2 * j + inc] > t) {
                j--;
            }
        }
        if (coords[2 * left + inc] === t) {
            swapItem(ids, coords, left, j);
        } else {
            j++;
            swapItem(ids, coords, j, right);
        }
        if (j <= k) {
            left = j + 1;
        }
        if (k <= j) {
            right = j - 1;
        }
    }
}
function swapItem(ids, coords, i, j) {
    swap(ids, i, j);
    swap(coords, 2 * i, 2 * j);
    swap(coords, 2 * i + 1, 2 * j + 1);
}
function swap(arr, i, j) {
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
}

function range(ids, coords, minX, minY, maxX, maxY, nodeSize) {
    var stack = [
        0,
        ids.length - 1,
        0
    ];
    var result = [];
    var x, y;
    while (stack.length) {
        var axis = stack.pop();
        var right = stack.pop();
        var left = stack.pop();
        if (right - left <= nodeSize) {
            for (var i = left; i <= right; i++) {
                x = coords[2 * i];
                y = coords[2 * i + 1];
                if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
                    result.push(ids[i]);
                }
            }
            continue;
        }
        var m = Math.floor((left + right) / 2);
        x = coords[2 * m];
        y = coords[2 * m + 1];
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
            result.push(ids[m]);
        }
        var nextAxis = (axis + 1) % 2;
        if (axis === 0 ? minX <= x : minY <= y) {
            stack.push(left);
            stack.push(m - 1);
            stack.push(nextAxis);
        }
        if (axis === 0 ? maxX >= x : maxY >= y) {
            stack.push(m + 1);
            stack.push(right);
            stack.push(nextAxis);
        }
    }
    return result;
}

function within(ids, coords, qx, qy, r, nodeSize) {
    var stack = [
        0,
        ids.length - 1,
        0
    ];
    var result = [];
    var r2 = r * r;
    while (stack.length) {
        var axis = stack.pop();
        var right = stack.pop();
        var left = stack.pop();
        if (right - left <= nodeSize) {
            for (var i = left; i <= right; i++) {
                if (sqDist(coords[2 * i], coords[2 * i + 1], qx, qy) <= r2) {
                    result.push(ids[i]);
                }
            }
            continue;
        }
        var m = Math.floor((left + right) / 2);
        var x = coords[2 * m];
        var y = coords[2 * m + 1];
        if (sqDist(x, y, qx, qy) <= r2) {
            result.push(ids[m]);
        }
        var nextAxis = (axis + 1) % 2;
        if (axis === 0 ? qx - r <= x : qy - r <= y) {
            stack.push(left);
            stack.push(m - 1);
            stack.push(nextAxis);
        }
        if (axis === 0 ? qx + r >= x : qy + r >= y) {
            stack.push(m + 1);
            stack.push(right);
            stack.push(nextAxis);
        }
    }
    return result;
}
function sqDist(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return dx * dx + dy * dy;
}

var defaultGetX = function (p) {
    return p[0];
};
var defaultGetY = function (p) {
    return p[1];
};
var KDBush = function KDBush(points, getX, getY, nodeSize, ArrayType) {
    if (getX === void 0)
        getX = defaultGetX;
    if (getY === void 0)
        getY = defaultGetY;
    if (nodeSize === void 0)
        nodeSize = 64;
    if (ArrayType === void 0)
        ArrayType = Float64Array;
    this.nodeSize = nodeSize;
    this.points = points;
    var IndexArrayType = points.length < 65536 ? Uint16Array : Uint32Array;
    var ids = this.ids = new IndexArrayType(points.length);
    var coords = this.coords = new ArrayType(points.length * 2);
    for (var i = 0; i < points.length; i++) {
        ids[i] = i;
        coords[2 * i] = getX(points[i]);
        coords[2 * i + 1] = getY(points[i]);
    }
    sortKD(ids, coords, nodeSize, 0, ids.length - 1, 0);
};
KDBush.prototype.range = function range$1(minX, minY, maxX, maxY) {
    return range(this.ids, this.coords, minX, minY, maxX, maxY, this.nodeSize);
};
KDBush.prototype.within = function within$1(x, y, r) {
    return within(this.ids, this.coords, x, y, r, this.nodeSize);
};

var defaultOptions = {
    minZoom: 0,
    maxZoom: 16,
    minPoints: 2,
    radius: 40,
    extent: 512,
    nodeSize: 64,
    log: false,
    generateId: false,
    reduce: null,
    map: function (props) {
        return props;
    }
};
var fround = Math.fround || function (tmp) {
    return function (x) {
        tmp[0] = +x;
        return tmp[0];
    };
}(new Float32Array(1));
var Supercluster = function Supercluster(options) {
    this.options = extend(Object.create(defaultOptions), options);
    this.trees = new Array(this.options.maxZoom + 1);
};
Supercluster.prototype.load = function load(points) {
    var ref = this.options;
    var log = ref.log;
    var minZoom = ref.minZoom;
    var maxZoom = ref.maxZoom;
    var nodeSize = ref.nodeSize;
    if (log) {
        console.time('total time');
    }
    var timerId = 'prepare ' + points.length + ' points';
    if (log) {
        console.time(timerId);
    }
    this.points = points;
    var clusters = [];
    for (var i = 0; i < points.length; i++) {
        if (!points[i].geometry) {
            continue;
        }
        clusters.push(createPointCluster(points[i], i));
    }
    this.trees[maxZoom + 1] = new KDBush(clusters, getX, getY, nodeSize, Float32Array);
    if (log) {
        console.timeEnd(timerId);
    }
    for (var z = maxZoom; z >= minZoom; z--) {
        var now = +Date.now();
        clusters = this._cluster(clusters, z);
        this.trees[z] = new KDBush(clusters, getX, getY, nodeSize, Float32Array);
        if (log) {
            console.log('z%d: %d clusters in %dms', z, clusters.length, +Date.now() - now);
        }
    }
    if (log) {
        console.timeEnd('total time');
    }
    return this;
};
Supercluster.prototype.getClusters = function getClusters(bbox, zoom) {
    var minLng = ((bbox[0] + 180) % 360 + 360) % 360 - 180;
    var minLat = Math.max(-90, Math.min(90, bbox[1]));
    var maxLng = bbox[2] === 180 ? 180 : ((bbox[2] + 180) % 360 + 360) % 360 - 180;
    var maxLat = Math.max(-90, Math.min(90, bbox[3]));
    if (bbox[2] - bbox[0] >= 360) {
        minLng = -180;
        maxLng = 180;
    } else if (minLng > maxLng) {
        var easternHem = this.getClusters([
            minLng,
            minLat,
            180,
            maxLat
        ], zoom);
        var westernHem = this.getClusters([
            -180,
            minLat,
            maxLng,
            maxLat
        ], zoom);
        return easternHem.concat(westernHem);
    }
    var tree = this.trees[this._limitZoom(zoom)];
    var ids = tree.range(lngX(minLng), latY(maxLat), lngX(maxLng), latY(minLat));
    var clusters = [];
    for (var i = 0, list = ids; i < list.length; i += 1) {
        var id = list[i];
        var c = tree.points[id];
        clusters.push(c.numPoints ? getClusterJSON(c) : this.points[c.index]);
    }
    return clusters;
};
Supercluster.prototype.getChildren = function getChildren(clusterId) {
    var originId = this._getOriginId(clusterId);
    var originZoom = this._getOriginZoom(clusterId);
    var errorMsg = 'No cluster with the specified id.';
    var index = this.trees[originZoom];
    if (!index) {
        throw new Error(errorMsg);
    }
    var origin = index.points[originId];
    if (!origin) {
        throw new Error(errorMsg);
    }
    var r = this.options.radius / (this.options.extent * Math.pow(2, originZoom - 1));
    var ids = index.within(origin.x, origin.y, r);
    var children = [];
    for (var i = 0, list = ids; i < list.length; i += 1) {
        var id = list[i];
        var c = index.points[id];
        if (c.parentId === clusterId) {
            children.push(c.numPoints ? getClusterJSON(c) : this.points[c.index]);
        }
    }
    if (children.length === 0) {
        throw new Error(errorMsg);
    }
    return children;
};
Supercluster.prototype.getLeaves = function getLeaves(clusterId, limit, offset) {
    limit = limit || 10;
    offset = offset || 0;
    var leaves = [];
    this._appendLeaves(leaves, clusterId, limit, offset, 0);
    return leaves;
};
Supercluster.prototype.getTile = function getTile(z, x, y) {
    var tree = this.trees[this._limitZoom(z)];
    var z2 = Math.pow(2, z);
    var ref = this.options;
    var extent = ref.extent;
    var radius = ref.radius;
    var p = radius / extent;
    var top = (y - p) / z2;
    var bottom = (y + 1 + p) / z2;
    var tile = { features: [] };
    this._addTileFeatures(tree.range((x - p) / z2, top, (x + 1 + p) / z2, bottom), tree.points, x, y, z2, tile);
    if (x === 0) {
        this._addTileFeatures(tree.range(1 - p / z2, top, 1, bottom), tree.points, z2, y, z2, tile);
    }
    if (x === z2 - 1) {
        this._addTileFeatures(tree.range(0, top, p / z2, bottom), tree.points, -1, y, z2, tile);
    }
    return tile.features.length ? tile : null;
};
Supercluster.prototype.getClusterExpansionZoom = function getClusterExpansionZoom(clusterId) {
    var expansionZoom = this._getOriginZoom(clusterId) - 1;
    while (expansionZoom <= this.options.maxZoom) {
        var children = this.getChildren(clusterId);
        expansionZoom++;
        if (children.length !== 1) {
            break;
        }
        clusterId = children[0].properties.cluster_id;
    }
    return expansionZoom;
};
Supercluster.prototype._appendLeaves = function _appendLeaves(result, clusterId, limit, offset, skipped) {
    var children = this.getChildren(clusterId);
    for (var i = 0, list = children; i < list.length; i += 1) {
        var child = list[i];
        var props = child.properties;
        if (props && props.cluster) {
            if (skipped + props.point_count <= offset) {
                skipped += props.point_count;
            } else {
                skipped = this._appendLeaves(result, props.cluster_id, limit, offset, skipped);
            }
        } else if (skipped < offset) {
            skipped++;
        } else {
            result.push(child);
        }
        if (result.length === limit) {
            break;
        }
    }
    return skipped;
};
Supercluster.prototype._addTileFeatures = function _addTileFeatures(ids, points, x, y, z2, tile) {
    for (var i$1 = 0, list = ids; i$1 < list.length; i$1 += 1) {
        var i = list[i$1];
        var c = points[i];
        var isCluster = c.numPoints;
        var tags = void 0, px = void 0, py = void 0;
        if (isCluster) {
            tags = getClusterProperties(c);
            px = c.x;
            py = c.y;
        } else {
            var p = this.points[c.index];
            tags = p.properties;
            px = lngX(p.geometry.coordinates[0]);
            py = latY(p.geometry.coordinates[1]);
        }
        var f = {
            type: 1,
            geometry: [[
                    Math.round(this.options.extent * (px * z2 - x)),
                    Math.round(this.options.extent * (py * z2 - y))
                ]],
            tags: tags
        };
        var id = void 0;
        if (isCluster) {
            id = c.id;
        } else if (this.options.generateId) {
            id = c.index;
        } else if (this.points[c.index].id) {
            id = this.points[c.index].id;
        }
        if (id !== undefined) {
            f.id = id;
        }
        tile.features.push(f);
    }
};
Supercluster.prototype._limitZoom = function _limitZoom(z) {
    return Math.max(this.options.minZoom, Math.min(Math.floor(+z), this.options.maxZoom + 1));
};
Supercluster.prototype._cluster = function _cluster(points, zoom) {
    var clusters = [];
    var ref = this.options;
    var radius = ref.radius;
    var extent = ref.extent;
    var reduce = ref.reduce;
    var minPoints = ref.minPoints;
    var r = radius / (extent * Math.pow(2, zoom));
    for (var i = 0; i < points.length; i++) {
        var p = points[i];
        if (p.zoom <= zoom) {
            continue;
        }
        p.zoom = zoom;
        var tree = this.trees[zoom + 1];
        var neighborIds = tree.within(p.x, p.y, r);
        var numPointsOrigin = p.numPoints || 1;
        var numPoints = numPointsOrigin;
        for (var i$1 = 0, list = neighborIds; i$1 < list.length; i$1 += 1) {
            var neighborId = list[i$1];
            var b = tree.points[neighborId];
            if (b.zoom > zoom) {
                numPoints += b.numPoints || 1;
            }
        }
        if (numPoints > numPointsOrigin && numPoints >= minPoints) {
            var wx = p.x * numPointsOrigin;
            var wy = p.y * numPointsOrigin;
            var clusterProperties = reduce && numPointsOrigin > 1 ? this._map(p, true) : null;
            var id = (i << 5) + (zoom + 1) + this.points.length;
            for (var i$2 = 0, list$1 = neighborIds; i$2 < list$1.length; i$2 += 1) {
                var neighborId$1 = list$1[i$2];
                var b$1 = tree.points[neighborId$1];
                if (b$1.zoom <= zoom) {
                    continue;
                }
                b$1.zoom = zoom;
                var numPoints2 = b$1.numPoints || 1;
                wx += b$1.x * numPoints2;
                wy += b$1.y * numPoints2;
                b$1.parentId = id;
                if (reduce) {
                    if (!clusterProperties) {
                        clusterProperties = this._map(p, true);
                    }
                    reduce(clusterProperties, this._map(b$1));
                }
            }
            p.parentId = id;
            clusters.push(createCluster(wx / numPoints, wy / numPoints, id, numPoints, clusterProperties));
        } else {
            clusters.push(p);
            if (numPoints > 1) {
                for (var i$3 = 0, list$2 = neighborIds; i$3 < list$2.length; i$3 += 1) {
                    var neighborId$2 = list$2[i$3];
                    var b$2 = tree.points[neighborId$2];
                    if (b$2.zoom <= zoom) {
                        continue;
                    }
                    b$2.zoom = zoom;
                    clusters.push(b$2);
                }
            }
        }
    }
    return clusters;
};
Supercluster.prototype._getOriginId = function _getOriginId(clusterId) {
    return clusterId - this.points.length >> 5;
};
Supercluster.prototype._getOriginZoom = function _getOriginZoom(clusterId) {
    return (clusterId - this.points.length) % 32;
};
Supercluster.prototype._map = function _map(point, clone) {
    if (point.numPoints) {
        return clone ? extend({}, point.properties) : point.properties;
    }
    var original = this.points[point.index].properties;
    var result = this.options.map(original);
    return clone && result === original ? extend({}, result) : result;
};
function createCluster(x, y, id, numPoints, properties) {
    return {
        x: fround(x),
        y: fround(y),
        zoom: Infinity,
        id: id,
        parentId: -1,
        numPoints: numPoints,
        properties: properties
    };
}
function createPointCluster(p, id) {
    var ref = p.geometry.coordinates;
    var x = ref[0];
    var y = ref[1];
    return {
        x: fround(lngX(x)),
        y: fround(latY(y)),
        zoom: Infinity,
        index: id,
        parentId: -1
    };
}
function getClusterJSON(cluster) {
    return {
        type: 'Feature',
        id: cluster.id,
        properties: getClusterProperties(cluster),
        geometry: {
            type: 'Point',
            coordinates: [
                xLng(cluster.x),
                yLat(cluster.y)
            ]
        }
    };
}
function getClusterProperties(cluster) {
    var count = cluster.numPoints;
    var abbrev = count >= 10000 ? Math.round(count / 1000) + 'k' : count >= 1000 ? Math.round(count / 100) / 10 + 'k' : count;
    return extend(extend({}, cluster.properties), {
        cluster: true,
        cluster_id: cluster.id,
        point_count: count,
        point_count_abbreviated: abbrev
    });
}
function lngX(lng) {
    return lng / 360 + 0.5;
}
function latY(lat) {
    var sin = Math.sin(lat * Math.PI / 180);
    var y = 0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI;
    return y < 0 ? 0 : y > 1 ? 1 : y;
}
function xLng(x) {
    return (x - 0.5) * 360;
}
function yLat(y) {
    var y2 = (180 - y * 360) * Math.PI / 180;
    return 360 * Math.atan(Math.exp(y2)) / Math.PI - 90;
}
function extend(dest, src) {
    for (var id in src) {
        dest[id] = src[id];
    }
    return dest;
}
function getX(p) {
    return p.x;
}
function getY(p) {
    return p.y;
}

function simplify(coords, first, last, sqTolerance) {
    var maxSqDist = sqTolerance;
    var mid = last - first >> 1;
    var minPosToMid = last - first;
    var index;
    var ax = coords[first];
    var ay = coords[first + 1];
    var bx = coords[last];
    var by = coords[last + 1];
    for (var i = first + 3; i < last; i += 3) {
        var d = getSqSegDist(coords[i], coords[i + 1], ax, ay, bx, by);
        if (d > maxSqDist) {
            index = i;
            maxSqDist = d;
        } else if (d === maxSqDist) {
            var posToMid = Math.abs(i - mid);
            if (posToMid < minPosToMid) {
                index = i;
                minPosToMid = posToMid;
            }
        }
    }
    if (maxSqDist > sqTolerance) {
        if (index - first > 3) {
            simplify(coords, first, index, sqTolerance);
        }
        coords[index + 2] = maxSqDist;
        if (last - index > 3) {
            simplify(coords, index, last, sqTolerance);
        }
    }
}
function getSqSegDist(px, py, x, y, bx, by) {
    var dx = bx - x;
    var dy = by - y;
    if (dx !== 0 || dy !== 0) {
        var t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) {
            x = bx;
            y = by;
        } else if (t > 0) {
            x += dx * t;
            y += dy * t;
        }
    }
    dx = px - x;
    dy = py - y;
    return dx * dx + dy * dy;
}

function createFeature(id, type, geom, tags) {
    var feature = {
        id: typeof id === 'undefined' ? null : id,
        type: type,
        geometry: geom,
        tags: tags,
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity
    };
    calcBBox(feature);
    return feature;
}
function calcBBox(feature) {
    var geom = feature.geometry;
    var type = feature.type;
    if (type === 'Point' || type === 'MultiPoint' || type === 'LineString') {
        calcLineBBox(feature, geom);
    } else if (type === 'Polygon' || type === 'MultiLineString') {
        for (var i = 0; i < geom.length; i++) {
            calcLineBBox(feature, geom[i]);
        }
    } else if (type === 'MultiPolygon') {
        for (i = 0; i < geom.length; i++) {
            for (var j = 0; j < geom[i].length; j++) {
                calcLineBBox(feature, geom[i][j]);
            }
        }
    }
}
function calcLineBBox(feature, geom) {
    for (var i = 0; i < geom.length; i += 3) {
        feature.minX = Math.min(feature.minX, geom[i]);
        feature.minY = Math.min(feature.minY, geom[i + 1]);
        feature.maxX = Math.max(feature.maxX, geom[i]);
        feature.maxY = Math.max(feature.maxY, geom[i + 1]);
    }
}

function convert(data, options) {
    var features = [];
    if (data.type === 'FeatureCollection') {
        for (var i = 0; i < data.features.length; i++) {
            convertFeature(features, data.features[i], options, i);
        }
    } else if (data.type === 'Feature') {
        convertFeature(features, data, options);
    } else {
        convertFeature(features, { geometry: data }, options);
    }
    return features;
}
function convertFeature(features, geojson, options, index) {
    if (!geojson.geometry) {
        return;
    }
    var coords = geojson.geometry.coordinates;
    var type = geojson.geometry.type;
    var tolerance = Math.pow(options.tolerance / ((1 << options.maxZoom) * options.extent), 2);
    var geometry = [];
    var id = geojson.id;
    if (options.promoteId) {
        id = geojson.properties[options.promoteId];
    } else if (options.generateId) {
        id = index || 0;
    }
    if (type === 'Point') {
        convertPoint(coords, geometry);
    } else if (type === 'MultiPoint') {
        for (var i = 0; i < coords.length; i++) {
            convertPoint(coords[i], geometry);
        }
    } else if (type === 'LineString') {
        convertLine(coords, geometry, tolerance, false);
    } else if (type === 'MultiLineString') {
        if (options.lineMetrics) {
            for (i = 0; i < coords.length; i++) {
                geometry = [];
                convertLine(coords[i], geometry, tolerance, false);
                features.push(createFeature(id, 'LineString', geometry, geojson.properties));
            }
            return;
        } else {
            convertLines(coords, geometry, tolerance, false);
        }
    } else if (type === 'Polygon') {
        convertLines(coords, geometry, tolerance, true);
    } else if (type === 'MultiPolygon') {
        for (i = 0; i < coords.length; i++) {
            var polygon = [];
            convertLines(coords[i], polygon, tolerance, true);
            geometry.push(polygon);
        }
    } else if (type === 'GeometryCollection') {
        for (i = 0; i < geojson.geometry.geometries.length; i++) {
            convertFeature(features, {
                id: id,
                geometry: geojson.geometry.geometries[i],
                properties: geojson.properties
            }, options, index);
        }
        return;
    } else {
        throw new Error('Input data is not a valid GeoJSON object.');
    }
    features.push(createFeature(id, type, geometry, geojson.properties));
}
function convertPoint(coords, out) {
    out.push(projectX(coords[0]));
    out.push(projectY(coords[1]));
    out.push(0);
}
function convertLine(ring, out, tolerance, isPolygon) {
    var x0, y0;
    var size = 0;
    for (var j = 0; j < ring.length; j++) {
        var x = projectX(ring[j][0]);
        var y = projectY(ring[j][1]);
        out.push(x);
        out.push(y);
        out.push(0);
        if (j > 0) {
            if (isPolygon) {
                size += (x0 * y - x * y0) / 2;
            } else {
                size += Math.sqrt(Math.pow(x - x0, 2) + Math.pow(y - y0, 2));
            }
        }
        x0 = x;
        y0 = y;
    }
    var last = out.length - 3;
    out[2] = 1;
    simplify(out, 0, last, tolerance);
    out[last + 2] = 1;
    out.size = Math.abs(size);
    out.start = 0;
    out.end = out.size;
}
function convertLines(rings, out, tolerance, isPolygon) {
    for (var i = 0; i < rings.length; i++) {
        var geom = [];
        convertLine(rings[i], geom, tolerance, isPolygon);
        out.push(geom);
    }
}
function projectX(x) {
    return x / 360 + 0.5;
}
function projectY(y) {
    var sin = Math.sin(y * Math.PI / 180);
    var y2 = 0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI;
    return y2 < 0 ? 0 : y2 > 1 ? 1 : y2;
}

function clip(features, scale, k1, k2, axis, minAll, maxAll, options) {
    k1 /= scale;
    k2 /= scale;
    if (minAll >= k1 && maxAll < k2) {
        return features;
    } else if (maxAll < k1 || minAll >= k2) {
        return null;
    }
    var clipped = [];
    for (var i = 0; i < features.length; i++) {
        var feature = features[i];
        var geometry = feature.geometry;
        var type = feature.type;
        var min = axis === 0 ? feature.minX : feature.minY;
        var max = axis === 0 ? feature.maxX : feature.maxY;
        if (min >= k1 && max < k2) {
            clipped.push(feature);
            continue;
        } else if (max < k1 || min >= k2) {
            continue;
        }
        var newGeometry = [];
        if (type === 'Point' || type === 'MultiPoint') {
            clipPoints(geometry, newGeometry, k1, k2, axis);
        } else if (type === 'LineString') {
            clipLine(geometry, newGeometry, k1, k2, axis, false, options.lineMetrics);
        } else if (type === 'MultiLineString') {
            clipLines(geometry, newGeometry, k1, k2, axis, false);
        } else if (type === 'Polygon') {
            clipLines(geometry, newGeometry, k1, k2, axis, true);
        } else if (type === 'MultiPolygon') {
            for (var j = 0; j < geometry.length; j++) {
                var polygon = [];
                clipLines(geometry[j], polygon, k1, k2, axis, true);
                if (polygon.length) {
                    newGeometry.push(polygon);
                }
            }
        }
        if (newGeometry.length) {
            if (options.lineMetrics && type === 'LineString') {
                for (j = 0; j < newGeometry.length; j++) {
                    clipped.push(createFeature(feature.id, type, newGeometry[j], feature.tags));
                }
                continue;
            }
            if (type === 'LineString' || type === 'MultiLineString') {
                if (newGeometry.length === 1) {
                    type = 'LineString';
                    newGeometry = newGeometry[0];
                } else {
                    type = 'MultiLineString';
                }
            }
            if (type === 'Point' || type === 'MultiPoint') {
                type = newGeometry.length === 3 ? 'Point' : 'MultiPoint';
            }
            clipped.push(createFeature(feature.id, type, newGeometry, feature.tags));
        }
    }
    return clipped.length ? clipped : null;
}
function clipPoints(geom, newGeom, k1, k2, axis) {
    for (var i = 0; i < geom.length; i += 3) {
        var a = geom[i + axis];
        if (a >= k1 && a <= k2) {
            newGeom.push(geom[i]);
            newGeom.push(geom[i + 1]);
            newGeom.push(geom[i + 2]);
        }
    }
}
function clipLine(geom, newGeom, k1, k2, axis, isPolygon, trackMetrics) {
    var slice = newSlice(geom);
    var intersect = axis === 0 ? intersectX : intersectY;
    var len = geom.start;
    var segLen, t;
    for (var i = 0; i < geom.length - 3; i += 3) {
        var ax = geom[i];
        var ay = geom[i + 1];
        var az = geom[i + 2];
        var bx = geom[i + 3];
        var by = geom[i + 4];
        var a = axis === 0 ? ax : ay;
        var b = axis === 0 ? bx : by;
        var exited = false;
        if (trackMetrics) {
            segLen = Math.sqrt(Math.pow(ax - bx, 2) + Math.pow(ay - by, 2));
        }
        if (a < k1) {
            if (b > k1) {
                t = intersect(slice, ax, ay, bx, by, k1);
                if (trackMetrics) {
                    slice.start = len + segLen * t;
                }
            }
        } else if (a > k2) {
            if (b < k2) {
                t = intersect(slice, ax, ay, bx, by, k2);
                if (trackMetrics) {
                    slice.start = len + segLen * t;
                }
            }
        } else {
            addPoint(slice, ax, ay, az);
        }
        if (b < k1 && a >= k1) {
            t = intersect(slice, ax, ay, bx, by, k1);
            exited = true;
        }
        if (b > k2 && a <= k2) {
            t = intersect(slice, ax, ay, bx, by, k2);
            exited = true;
        }
        if (!isPolygon && exited) {
            if (trackMetrics) {
                slice.end = len + segLen * t;
            }
            newGeom.push(slice);
            slice = newSlice(geom);
        }
        if (trackMetrics) {
            len += segLen;
        }
    }
    var last = geom.length - 3;
    ax = geom[last];
    ay = geom[last + 1];
    az = geom[last + 2];
    a = axis === 0 ? ax : ay;
    if (a >= k1 && a <= k2) {
        addPoint(slice, ax, ay, az);
    }
    last = slice.length - 3;
    if (isPolygon && last >= 3 && (slice[last] !== slice[0] || slice[last + 1] !== slice[1])) {
        addPoint(slice, slice[0], slice[1], slice[2]);
    }
    if (slice.length) {
        newGeom.push(slice);
    }
}
function newSlice(line) {
    var slice = [];
    slice.size = line.size;
    slice.start = line.start;
    slice.end = line.end;
    return slice;
}
function clipLines(geom, newGeom, k1, k2, axis, isPolygon) {
    for (var i = 0; i < geom.length; i++) {
        clipLine(geom[i], newGeom, k1, k2, axis, isPolygon, false);
    }
}
function addPoint(out, x, y, z) {
    out.push(x);
    out.push(y);
    out.push(z);
}
function intersectX(out, ax, ay, bx, by, x) {
    var t = (x - ax) / (bx - ax);
    out.push(x);
    out.push(ay + (by - ay) * t);
    out.push(1);
    return t;
}
function intersectY(out, ax, ay, bx, by, y) {
    var t = (y - ay) / (by - ay);
    out.push(ax + (bx - ax) * t);
    out.push(y);
    out.push(1);
    return t;
}

function wrap(features, options) {
    var buffer = options.buffer / options.extent;
    var merged = features;
    var left = clip(features, 1, -1 - buffer, buffer, 0, -1, 2, options);
    var right = clip(features, 1, 1 - buffer, 2 + buffer, 0, -1, 2, options);
    if (left || right) {
        merged = clip(features, 1, -buffer, 1 + buffer, 0, -1, 2, options) || [];
        if (left) {
            merged = shiftFeatureCoords(left, 1).concat(merged);
        }
        if (right) {
            merged = merged.concat(shiftFeatureCoords(right, -1));
        }
    }
    return merged;
}
function shiftFeatureCoords(features, offset) {
    var newFeatures = [];
    for (var i = 0; i < features.length; i++) {
        var feature = features[i], type = feature.type;
        var newGeometry;
        if (type === 'Point' || type === 'MultiPoint' || type === 'LineString') {
            newGeometry = shiftCoords(feature.geometry, offset);
        } else if (type === 'MultiLineString' || type === 'Polygon') {
            newGeometry = [];
            for (var j = 0; j < feature.geometry.length; j++) {
                newGeometry.push(shiftCoords(feature.geometry[j], offset));
            }
        } else if (type === 'MultiPolygon') {
            newGeometry = [];
            for (j = 0; j < feature.geometry.length; j++) {
                var newPolygon = [];
                for (var k = 0; k < feature.geometry[j].length; k++) {
                    newPolygon.push(shiftCoords(feature.geometry[j][k], offset));
                }
                newGeometry.push(newPolygon);
            }
        }
        newFeatures.push(createFeature(feature.id, type, newGeometry, feature.tags));
    }
    return newFeatures;
}
function shiftCoords(points, offset) {
    var newPoints = [];
    newPoints.size = points.size;
    if (points.start !== undefined) {
        newPoints.start = points.start;
        newPoints.end = points.end;
    }
    for (var i = 0; i < points.length; i += 3) {
        newPoints.push(points[i] + offset, points[i + 1], points[i + 2]);
    }
    return newPoints;
}

function transformTile(tile, extent) {
    if (tile.transformed) {
        return tile;
    }
    var z2 = 1 << tile.z, tx = tile.x, ty = tile.y, i, j, k;
    for (i = 0; i < tile.features.length; i++) {
        var feature = tile.features[i], geom = feature.geometry, type = feature.type;
        feature.geometry = [];
        if (type === 1) {
            for (j = 0; j < geom.length; j += 2) {
                feature.geometry.push(transformPoint(geom[j], geom[j + 1], extent, z2, tx, ty));
            }
        } else {
            for (j = 0; j < geom.length; j++) {
                var ring = [];
                for (k = 0; k < geom[j].length; k += 2) {
                    ring.push(transformPoint(geom[j][k], geom[j][k + 1], extent, z2, tx, ty));
                }
                feature.geometry.push(ring);
            }
        }
    }
    tile.transformed = true;
    return tile;
}
function transformPoint(x, y, extent, z2, tx, ty) {
    return [
        Math.round(extent * (x * z2 - tx)),
        Math.round(extent * (y * z2 - ty))
    ];
}

function createTile(features, z, tx, ty, options) {
    var tolerance = z === options.maxZoom ? 0 : options.tolerance / ((1 << z) * options.extent);
    var tile = {
        features: [],
        numPoints: 0,
        numSimplified: 0,
        numFeatures: 0,
        source: null,
        x: tx,
        y: ty,
        z: z,
        transformed: false,
        minX: 2,
        minY: 1,
        maxX: -1,
        maxY: 0
    };
    for (var i = 0; i < features.length; i++) {
        tile.numFeatures++;
        addFeature(tile, features[i], tolerance, options);
        var minX = features[i].minX;
        var minY = features[i].minY;
        var maxX = features[i].maxX;
        var maxY = features[i].maxY;
        if (minX < tile.minX) {
            tile.minX = minX;
        }
        if (minY < tile.minY) {
            tile.minY = minY;
        }
        if (maxX > tile.maxX) {
            tile.maxX = maxX;
        }
        if (maxY > tile.maxY) {
            tile.maxY = maxY;
        }
    }
    return tile;
}
function addFeature(tile, feature, tolerance, options) {
    var geom = feature.geometry, type = feature.type, simplified = [];
    if (type === 'Point' || type === 'MultiPoint') {
        for (var i = 0; i < geom.length; i += 3) {
            simplified.push(geom[i]);
            simplified.push(geom[i + 1]);
            tile.numPoints++;
            tile.numSimplified++;
        }
    } else if (type === 'LineString') {
        addLine(simplified, geom, tile, tolerance, false, false);
    } else if (type === 'MultiLineString' || type === 'Polygon') {
        for (i = 0; i < geom.length; i++) {
            addLine(simplified, geom[i], tile, tolerance, type === 'Polygon', i === 0);
        }
    } else if (type === 'MultiPolygon') {
        for (var k = 0; k < geom.length; k++) {
            var polygon = geom[k];
            for (i = 0; i < polygon.length; i++) {
                addLine(simplified, polygon[i], tile, tolerance, true, i === 0);
            }
        }
    }
    if (simplified.length) {
        var tags = feature.tags || null;
        if (type === 'LineString' && options.lineMetrics) {
            tags = {};
            for (var key in feature.tags) {
                tags[key] = feature.tags[key];
            }
            tags['mapbox_clip_start'] = geom.start / geom.size;
            tags['mapbox_clip_end'] = geom.end / geom.size;
        }
        var tileFeature = {
            geometry: simplified,
            type: type === 'Polygon' || type === 'MultiPolygon' ? 3 : type === 'LineString' || type === 'MultiLineString' ? 2 : 1,
            tags: tags
        };
        if (feature.id !== null) {
            tileFeature.id = feature.id;
        }
        tile.features.push(tileFeature);
    }
}
function addLine(result, geom, tile, tolerance, isPolygon, isOuter) {
    var sqTolerance = tolerance * tolerance;
    if (tolerance > 0 && geom.size < (isPolygon ? sqTolerance : tolerance)) {
        tile.numPoints += geom.length / 3;
        return;
    }
    var ring = [];
    for (var i = 0; i < geom.length; i += 3) {
        if (tolerance === 0 || geom[i + 2] > sqTolerance) {
            tile.numSimplified++;
            ring.push(geom[i]);
            ring.push(geom[i + 1]);
        }
        tile.numPoints++;
    }
    if (isPolygon) {
        rewind$1(ring, isOuter);
    }
    result.push(ring);
}
function rewind$1(ring, clockwise) {
    var area = 0;
    for (var i = 0, len = ring.length, j = len - 2; i < len; j = i, i += 2) {
        area += (ring[i] - ring[j]) * (ring[i + 1] + ring[j + 1]);
    }
    if (area > 0 === clockwise) {
        for (i = 0, len = ring.length; i < len / 2; i += 2) {
            var x = ring[i];
            var y = ring[i + 1];
            ring[i] = ring[len - 2 - i];
            ring[i + 1] = ring[len - 1 - i];
            ring[len - 2 - i] = x;
            ring[len - 1 - i] = y;
        }
    }
}

function geojsonvt(data, options) {
    return new GeoJSONVT(data, options);
}
function GeoJSONVT(data, options) {
    options = this.options = extend$1(Object.create(this.options), options);
    var debug = options.debug;
    if (debug) {
        console.time('preprocess data');
    }
    if (options.maxZoom < 0 || options.maxZoom > 24) {
        throw new Error('maxZoom should be in the 0-24 range');
    }
    if (options.promoteId && options.generateId) {
        throw new Error('promoteId and generateId cannot be used together.');
    }
    var features = convert(data, options);
    this.tiles = {};
    this.tileCoords = [];
    if (debug) {
        console.timeEnd('preprocess data');
        console.log('index: maxZoom: %d, maxPoints: %d', options.indexMaxZoom, options.indexMaxPoints);
        console.time('generate tiles');
        this.stats = {};
        this.total = 0;
    }
    features = wrap(features, options);
    if (features.length) {
        this.splitTile(features, 0, 0, 0);
    }
    if (debug) {
        if (features.length) {
            console.log('features: %d, points: %d', this.tiles[0].numFeatures, this.tiles[0].numPoints);
        }
        console.timeEnd('generate tiles');
        console.log('tiles generated:', this.total, JSON.stringify(this.stats));
    }
}
GeoJSONVT.prototype.options = {
    maxZoom: 14,
    indexMaxZoom: 5,
    indexMaxPoints: 100000,
    tolerance: 3,
    extent: 4096,
    buffer: 64,
    lineMetrics: false,
    promoteId: null,
    generateId: false,
    debug: 0
};
GeoJSONVT.prototype.splitTile = function (features, z, x, y, cz, cx, cy) {
    var stack = [
            features,
            z,
            x,
            y
        ], options = this.options, debug = options.debug;
    while (stack.length) {
        y = stack.pop();
        x = stack.pop();
        z = stack.pop();
        features = stack.pop();
        var z2 = 1 << z, id = toID(z, x, y), tile = this.tiles[id];
        if (!tile) {
            if (debug > 1) {
                console.time('creation');
            }
            tile = this.tiles[id] = createTile(features, z, x, y, options);
            this.tileCoords.push({
                z: z,
                x: x,
                y: y
            });
            if (debug) {
                if (debug > 1) {
                    console.log('tile z%d-%d-%d (features: %d, points: %d, simplified: %d)', z, x, y, tile.numFeatures, tile.numPoints, tile.numSimplified);
                    console.timeEnd('creation');
                }
                var key = 'z' + z;
                this.stats[key] = (this.stats[key] || 0) + 1;
                this.total++;
            }
        }
        tile.source = features;
        if (!cz) {
            if (z === options.indexMaxZoom || tile.numPoints <= options.indexMaxPoints) {
                continue;
            }
        } else {
            if (z === options.maxZoom || z === cz) {
                continue;
            }
            var m = 1 << cz - z;
            if (x !== Math.floor(cx / m) || y !== Math.floor(cy / m)) {
                continue;
            }
        }
        tile.source = null;
        if (features.length === 0) {
            continue;
        }
        if (debug > 1) {
            console.time('clipping');
        }
        var k1 = 0.5 * options.buffer / options.extent, k2 = 0.5 - k1, k3 = 0.5 + k1, k4 = 1 + k1, tl, bl, tr, br, left, right;
        tl = bl = tr = br = null;
        left = clip(features, z2, x - k1, x + k3, 0, tile.minX, tile.maxX, options);
        right = clip(features, z2, x + k2, x + k4, 0, tile.minX, tile.maxX, options);
        features = null;
        if (left) {
            tl = clip(left, z2, y - k1, y + k3, 1, tile.minY, tile.maxY, options);
            bl = clip(left, z2, y + k2, y + k4, 1, tile.minY, tile.maxY, options);
            left = null;
        }
        if (right) {
            tr = clip(right, z2, y - k1, y + k3, 1, tile.minY, tile.maxY, options);
            br = clip(right, z2, y + k2, y + k4, 1, tile.minY, tile.maxY, options);
            right = null;
        }
        if (debug > 1) {
            console.timeEnd('clipping');
        }
        stack.push(tl || [], z + 1, x * 2, y * 2);
        stack.push(bl || [], z + 1, x * 2, y * 2 + 1);
        stack.push(tr || [], z + 1, x * 2 + 1, y * 2);
        stack.push(br || [], z + 1, x * 2 + 1, y * 2 + 1);
    }
};
GeoJSONVT.prototype.getTile = function (z, x, y) {
    var options = this.options, extent = options.extent, debug = options.debug;
    if (z < 0 || z > 24) {
        return null;
    }
    var z2 = 1 << z;
    x = (x % z2 + z2) % z2;
    var id = toID(z, x, y);
    if (this.tiles[id]) {
        return transformTile(this.tiles[id], extent);
    }
    if (debug > 1) {
        console.log('drilling down to z%d-%d-%d', z, x, y);
    }
    var z0 = z, x0 = x, y0 = y, parent;
    while (!parent && z0 > 0) {
        z0--;
        x0 = Math.floor(x0 / 2);
        y0 = Math.floor(y0 / 2);
        parent = this.tiles[toID(z0, x0, y0)];
    }
    if (!parent || !parent.source) {
        return null;
    }
    if (debug > 1) {
        console.log('found parent tile z%d-%d-%d', z0, x0, y0);
    }
    if (debug > 1) {
        console.time('drilling down');
    }
    this.splitTile(parent.source, z0, x0, y0, z, x, y);
    if (debug > 1) {
        console.timeEnd('drilling down');
    }
    return this.tiles[id] ? transformTile(this.tiles[id], extent) : null;
};
function toID(z, x, y) {
    return ((1 << z) * y + x) * 32 + z;
}
function extend$1(dest, src) {
    for (var i in src) {
        dest[i] = src[i];
    }
    return dest;
}

function loadGeoJSONTile(params, callback) {
    var canonical = params.tileID.canonical;
    if (!this._geoJSONIndex) {
        return callback(null, null);
    }
    var geoJSONTile = this._geoJSONIndex.getTile(canonical.z, canonical.x, canonical.y);
    if (!geoJSONTile) {
        return callback(null, null);
    }
    var geojsonWrapper = new GeoJSONWrapper(geoJSONTile.features);
    var pbf = vtPbf(geojsonWrapper);
    if (pbf.byteOffset !== 0 || pbf.byteLength !== pbf.buffer.byteLength) {
        pbf = new Uint8Array(pbf);
    }
    callback(null, {
        vectorTile: geojsonWrapper,
        rawData: pbf.buffer
    });
}
var GeoJSONWorkerSource = function (VectorTileWorkerSource) {
    function GeoJSONWorkerSource(actor, layerIndex, availableImages, loadGeoJSON) {
        VectorTileWorkerSource.call(this, actor, layerIndex, availableImages, loadGeoJSONTile);
        if (loadGeoJSON) {
            this.loadGeoJSON = loadGeoJSON;
        }
    }
    if (VectorTileWorkerSource)
        GeoJSONWorkerSource.__proto__ = VectorTileWorkerSource;
    GeoJSONWorkerSource.prototype = Object.create(VectorTileWorkerSource && VectorTileWorkerSource.prototype);
    GeoJSONWorkerSource.prototype.constructor = GeoJSONWorkerSource;
    GeoJSONWorkerSource.prototype.loadData = function loadData(params, callback) {
        if (this._pendingCallback) {
            this._pendingCallback(null, { abandoned: true });
        }
        this._pendingCallback = callback;
        this._pendingLoadDataParams = params;
        if (this._state && this._state !== 'Idle') {
            this._state = 'NeedsLoadData';
        } else {
            this._state = 'Coalescing';
            this._loadData();
        }
    };
    GeoJSONWorkerSource.prototype._loadData = function _loadData() {
        var this$1 = this;
        if (!this._pendingCallback || !this._pendingLoadDataParams) {
            return;
        }
        var callback = this._pendingCallback;
        var params = this._pendingLoadDataParams;
        delete this._pendingCallback;
        delete this._pendingLoadDataParams;
        var perf = params && params.request && params.request.collectResourceTiming ? new performance.RequestPerformance(params.request) : false;
        this.loadGeoJSON(params, function (err, data) {
            if (err || !data) {
                return callback(err);
            } else if (typeof data !== 'object') {
                return callback(new Error('Input data given to \'' + params.source + '\' is not a valid GeoJSON object.'));
            } else {
                geojsonRewind(data, true);
                try {
                    if (params.filter) {
                        var compiled = performance.createExpression(params.filter, {
                            type: 'boolean',
                            'property-type': 'data-driven',
                            overridable: false,
                            transition: false
                        });
                        if (compiled.result === 'error') {
                            throw new Error(compiled.value.map(function (err) {
                                return err.key + ': ' + err.message;
                            }).join(', '));
                        }
                        var features = data.features.filter(function (feature) {
                            return compiled.value.evaluate({ zoom: 0 }, feature);
                        });
                        data = {
                            type: 'FeatureCollection',
                            features: features
                        };
                    }
                    this$1._geoJSONIndex = params.cluster ? new Supercluster(getSuperclusterOptions(params)).load(data.features) : geojsonvt(data, params.geojsonVtOptions);
                } catch (err) {
                    return callback(err);
                }
                this$1.loaded = {};
                var result = {};
                if (perf) {
                    var resourceTimingData = perf.finish();
                    if (resourceTimingData) {
                        result.resourceTiming = {};
                        result.resourceTiming[params.source] = JSON.parse(JSON.stringify(resourceTimingData));
                    }
                }
                callback(null, result);
            }
        });
    };
    GeoJSONWorkerSource.prototype.coalesce = function coalesce() {
        if (this._state === 'Coalescing') {
            this._state = 'Idle';
        } else if (this._state === 'NeedsLoadData') {
            this._state = 'Coalescing';
            this._loadData();
        }
    };
    GeoJSONWorkerSource.prototype.reloadTile = function reloadTile(params, callback) {
        var loaded = this.loaded, uid = params.uid;
        if (loaded && loaded[uid]) {
            return VectorTileWorkerSource.prototype.reloadTile.call(this, params, callback);
        } else {
            return this.loadTile(params, callback);
        }
    };
    GeoJSONWorkerSource.prototype.loadGeoJSON = function loadGeoJSON(params, callback) {
        if (params.request) {
            performance.getJSON(params.request, callback);
        } else if (typeof params.data === 'string') {
            try {
                return callback(null, JSON.parse(params.data));
            } catch (e) {
                return callback(new Error('Input data given to \'' + params.source + '\' is not a valid GeoJSON object.'));
            }
        } else {
            return callback(new Error('Input data given to \'' + params.source + '\' is not a valid GeoJSON object.'));
        }
    };
    GeoJSONWorkerSource.prototype.removeSource = function removeSource(params, callback) {
        if (this._pendingCallback) {
            this._pendingCallback(null, { abandoned: true });
        }
        callback();
    };
    GeoJSONWorkerSource.prototype.getClusterExpansionZoom = function getClusterExpansionZoom(params, callback) {
        try {
            callback(null, this._geoJSONIndex.getClusterExpansionZoom(params.clusterId));
        } catch (e) {
            callback(e);
        }
    };
    GeoJSONWorkerSource.prototype.getClusterChildren = function getClusterChildren(params, callback) {
        try {
            callback(null, this._geoJSONIndex.getChildren(params.clusterId));
        } catch (e) {
            callback(e);
        }
    };
    GeoJSONWorkerSource.prototype.getClusterLeaves = function getClusterLeaves(params, callback) {
        try {
            callback(null, this._geoJSONIndex.getLeaves(params.clusterId, params.limit, params.offset));
        } catch (e) {
            callback(e);
        }
    };
    return GeoJSONWorkerSource;
}(VectorTileWorkerSource);
function getSuperclusterOptions(ref) {
    var superclusterOptions = ref.superclusterOptions;
    var clusterProperties = ref.clusterProperties;
    if (!clusterProperties || !superclusterOptions) {
        return superclusterOptions;
    }
    var mapExpressions = {};
    var reduceExpressions = {};
    var globals = {
        accumulated: null,
        zoom: 0
    };
    var feature = { properties: null };
    var propertyNames = Object.keys(clusterProperties);
    for (var i = 0, list = propertyNames; i < list.length; i += 1) {
        var key = list[i];
        var ref$1 = clusterProperties[key];
        var operator = ref$1[0];
        var mapExpression = ref$1[1];
        var mapExpressionParsed = performance.createExpression(mapExpression);
        var reduceExpressionParsed = performance.createExpression(typeof operator === 'string' ? [
            operator,
            ['accumulated'],
            [
                'get',
                key
            ]
        ] : operator);
        mapExpressions[key] = mapExpressionParsed.value;
        reduceExpressions[key] = reduceExpressionParsed.value;
    }
    superclusterOptions.map = function (pointProperties) {
        feature.properties = pointProperties;
        var properties = {};
        for (var i = 0, list = propertyNames; i < list.length; i += 1) {
            var key = list[i];
            properties[key] = mapExpressions[key].evaluate(globals, feature);
        }
        return properties;
    };
    superclusterOptions.reduce = function (accumulated, clusterProperties) {
        feature.properties = clusterProperties;
        for (var i = 0, list = propertyNames; i < list.length; i += 1) {
            var key = list[i];
            globals.accumulated = accumulated[key];
            accumulated[key] = reduceExpressions[key].evaluate(globals, feature);
        }
    };
    return superclusterOptions;
}

var Worker = function Worker(self) {
    var this$1 = this;
    this.self = self;
    this.actor = new performance.Actor(self, this);
    this.layerIndexes = {};
    this.availableImages = {};
    this.workerSourceTypes = {
        vector: VectorTileWorkerSource,
        geojson: GeoJSONWorkerSource
    };
    this.workerSources = {};
    this.demWorkerSources = {};
    this.self.registerWorkerSource = function (name, WorkerSource) {
        if (this$1.workerSourceTypes[name]) {
            throw new Error('Worker source with name "' + name + '" already registered.');
        }
        this$1.workerSourceTypes[name] = WorkerSource;
    };
    this.self.registerRTLTextPlugin = function (rtlTextPlugin) {
        if (performance.plugin.isParsed()) {
            throw new Error('RTL text plugin already registered.');
        }
        performance.plugin['applyArabicShaping'] = rtlTextPlugin.applyArabicShaping;
        performance.plugin['processBidirectionalText'] = rtlTextPlugin.processBidirectionalText;
        performance.plugin['processStyledBidirectionalText'] = rtlTextPlugin.processStyledBidirectionalText;
    };
};
Worker.prototype.setReferrer = function setReferrer(mapID, referrer) {
    this.referrer = referrer;
};
Worker.prototype.setImages = function setImages(mapId, images, callback) {
    this.availableImages[mapId] = images;
    for (var workerSource in this.workerSources[mapId]) {
        var ws = this.workerSources[mapId][workerSource];
        for (var source in ws) {
            ws[source].availableImages = images;
        }
    }
    callback();
};
Worker.prototype.setLayers = function setLayers(mapId, layers, callback) {
    this.getLayerIndex(mapId).replace(layers);
    callback();
};
Worker.prototype.updateLayers = function updateLayers(mapId, params, callback) {
    this.getLayerIndex(mapId).update(params.layers, params.removedIds);
    callback();
};
Worker.prototype.loadTile = function loadTile(mapId, params, callback) {
    this.getWorkerSource(mapId, params.type, params.source).loadTile(params, callback);
};
Worker.prototype.loadDEMTile = function loadDEMTile(mapId, params, callback) {
    this.getDEMWorkerSource(mapId, params.source).loadTile(params, callback);
};
Worker.prototype.reloadTile = function reloadTile(mapId, params, callback) {
    this.getWorkerSource(mapId, params.type, params.source).reloadTile(params, callback);
};
Worker.prototype.abortTile = function abortTile(mapId, params, callback) {
    this.getWorkerSource(mapId, params.type, params.source).abortTile(params, callback);
};
Worker.prototype.removeTile = function removeTile(mapId, params, callback) {
    this.getWorkerSource(mapId, params.type, params.source).removeTile(params, callback);
};
Worker.prototype.removeDEMTile = function removeDEMTile(mapId, params) {
    this.getDEMWorkerSource(mapId, params.source).removeTile(params);
};
Worker.prototype.removeSource = function removeSource(mapId, params, callback) {
    if (!this.workerSources[mapId] || !this.workerSources[mapId][params.type] || !this.workerSources[mapId][params.type][params.source]) {
        return;
    }
    var worker = this.workerSources[mapId][params.type][params.source];
    delete this.workerSources[mapId][params.type][params.source];
    if (worker.removeSource !== undefined) {
        worker.removeSource(params, callback);
    } else {
        callback();
    }
};
Worker.prototype.loadWorkerSource = function loadWorkerSource(map, params, callback) {
    try {
        this.self.importScripts(params.url);
        callback();
    } catch (e) {
        callback(e.toString());
    }
};
Worker.prototype.syncRTLPluginState = function syncRTLPluginState(map, state, callback) {
    try {
        performance.plugin.setState(state);
        var pluginURL = performance.plugin.getPluginURL();
        if (performance.plugin.isLoaded() && !performance.plugin.isParsed() && pluginURL != null) {
            this.self.importScripts(pluginURL);
            var complete = performance.plugin.isParsed();
            var error = complete ? undefined : new Error('RTL Text Plugin failed to import scripts from ' + pluginURL);
            callback(error, complete);
        }
    } catch (e) {
        callback(e.toString());
    }
};
Worker.prototype.getAvailableImages = function getAvailableImages(mapId) {
    var availableImages = this.availableImages[mapId];
    if (!availableImages) {
        availableImages = [];
    }
    return availableImages;
};
Worker.prototype.getLayerIndex = function getLayerIndex(mapId) {
    var layerIndexes = this.layerIndexes[mapId];
    if (!layerIndexes) {
        layerIndexes = this.layerIndexes[mapId] = new StyleLayerIndex();
    }
    return layerIndexes;
};
Worker.prototype.getWorkerSource = function getWorkerSource(mapId, type, source) {
    var this$1 = this;
    if (!this.workerSources[mapId]) {
        this.workerSources[mapId] = {};
    }
    if (!this.workerSources[mapId][type]) {
        this.workerSources[mapId][type] = {};
    }
    if (!this.workerSources[mapId][type][source]) {
        var actor = {
            send: function (type, data, callback) {
                this$1.actor.send(type, data, callback, mapId);
            }
        };
        this.workerSources[mapId][type][source] = new this.workerSourceTypes[type](actor, this.getLayerIndex(mapId), this.getAvailableImages(mapId));
    }
    return this.workerSources[mapId][type][source];
};
Worker.prototype.getDEMWorkerSource = function getDEMWorkerSource(mapId, source) {
    if (!this.demWorkerSources[mapId]) {
        this.demWorkerSources[mapId] = {};
    }
    if (!this.demWorkerSources[mapId][source]) {
        this.demWorkerSources[mapId][source] = new RasterDEMTileWorkerSource();
    }
    return this.demWorkerSources[mapId][source];
};
Worker.prototype.enforceCacheSizeLimit = function enforceCacheSizeLimit$1(mapId, limit) {
    performance.enforceCacheSizeLimit(limit);
};
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) {
    self.worker = new Worker(self);
}

return Worker;

});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2VyLmpzIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3R5bGUtc3BlYy9ncm91cF9ieV9sYXlvdXQuanMiLCIuLi8uLi8uLi9zcmMvc3R5bGUvc3R5bGVfbGF5ZXJfaW5kZXguanMiLCIuLi8uLi8uLi9zcmMvcmVuZGVyL2dseXBoX2F0bGFzLmpzIiwiLi4vLi4vLi4vc3JjL3NvdXJjZS93b3JrZXJfdGlsZS5qcyIsIi4uLy4uLy4uL3NyYy9zb3VyY2UvdmVjdG9yX3RpbGVfd29ya2VyX3NvdXJjZS5qcyIsIi4uLy4uLy4uL3NyYy9zb3VyY2UvcmFzdGVyX2RlbV90aWxlX3dvcmtlcl9zb3VyY2UuanMiLCIuLi8uLi8uLi9ub2RlX21vZHVsZXMvQG1hcGJveC9nZW9qc29uLXJld2luZC9pbmRleC5qcyIsIi4uLy4uLy4uL3NyYy9zb3VyY2UvZ2VvanNvbl93cmFwcGVyLmpzIiwiLi4vLi4vLi4vbm9kZV9tb2R1bGVzL3Z0LXBiZi9saWIvZ2VvanNvbl93cmFwcGVyLmpzIiwiLi4vLi4vLi4vbm9kZV9tb2R1bGVzL3Z0LXBiZi9pbmRleC5qcyIsIi4uLy4uLy4uL25vZGVfbW9kdWxlcy9rZGJ1c2gvc3JjL3NvcnQuanMiLCIuLi8uLi8uLi9ub2RlX21vZHVsZXMva2RidXNoL3NyYy9yYW5nZS5qcyIsIi4uLy4uLy4uL25vZGVfbW9kdWxlcy9rZGJ1c2gvc3JjL3dpdGhpbi5qcyIsIi4uLy4uLy4uL25vZGVfbW9kdWxlcy9rZGJ1c2gvc3JjL2luZGV4LmpzIiwiLi4vLi4vLi4vbm9kZV9tb2R1bGVzL3N1cGVyY2x1c3Rlci9pbmRleC5qcyIsIi4uLy4uLy4uL25vZGVfbW9kdWxlcy9nZW9qc29uLXZ0L3NyYy9zaW1wbGlmeS5qcyIsIi4uLy4uLy4uL25vZGVfbW9kdWxlcy9nZW9qc29uLXZ0L3NyYy9mZWF0dXJlLmpzIiwiLi4vLi4vLi4vbm9kZV9tb2R1bGVzL2dlb2pzb24tdnQvc3JjL2NvbnZlcnQuanMiLCIuLi8uLi8uLi9ub2RlX21vZHVsZXMvZ2VvanNvbi12dC9zcmMvY2xpcC5qcyIsIi4uLy4uLy4uL25vZGVfbW9kdWxlcy9nZW9qc29uLXZ0L3NyYy93cmFwLmpzIiwiLi4vLi4vLi4vbm9kZV9tb2R1bGVzL2dlb2pzb24tdnQvc3JjL3RyYW5zZm9ybS5qcyIsIi4uLy4uLy4uL25vZGVfbW9kdWxlcy9nZW9qc29uLXZ0L3NyYy90aWxlLmpzIiwiLi4vLi4vLi4vbm9kZV9tb2R1bGVzL2dlb2pzb24tdnQvc3JjL2luZGV4LmpzIiwiLi4vLi4vLi4vc3JjL3NvdXJjZS9nZW9qc29uX3dvcmtlcl9zb3VyY2UuanMiLCIuLi8uLi8uLi9zcmMvc291cmNlL3dvcmtlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJcbmltcG9ydCByZWZQcm9wZXJ0aWVzIGZyb20gJy4vdXRpbC9yZWZfcHJvcGVydGllcyc7XG5cbmZ1bmN0aW9uIHN0cmluZ2lmeShvYmopIHtcbiAgICBjb25zdCB0eXBlID0gdHlwZW9mIG9iajtcbiAgICBpZiAodHlwZSA9PT0gJ251bWJlcicgfHwgdHlwZSA9PT0gJ2Jvb2xlYW4nIHx8IHR5cGUgPT09ICdzdHJpbmcnIHx8IG9iaiA9PT0gdW5kZWZpbmVkIHx8IG9iaiA9PT0gbnVsbClcbiAgICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KG9iaik7XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShvYmopKSB7XG4gICAgICAgIGxldCBzdHIgPSAnWyc7XG4gICAgICAgIGZvciAoY29uc3QgdmFsIG9mIG9iaikge1xuICAgICAgICAgICAgc3RyICs9IGAke3N0cmluZ2lmeSh2YWwpfSxgO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBgJHtzdHJ9XWA7XG4gICAgfVxuXG4gICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKG9iaikuc29ydCgpO1xuXG4gICAgbGV0IHN0ciA9ICd7JztcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGtleXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgc3RyICs9IGAke0pTT04uc3RyaW5naWZ5KGtleXNbaV0pfToke3N0cmluZ2lmeShvYmpba2V5c1tpXV0pfSxgO1xuICAgIH1cbiAgICByZXR1cm4gYCR7c3RyfX1gO1xufVxuXG5mdW5jdGlvbiBnZXRLZXkobGF5ZXIpIHtcbiAgICBsZXQga2V5ID0gJyc7XG4gICAgZm9yIChjb25zdCBrIG9mIHJlZlByb3BlcnRpZXMpIHtcbiAgICAgICAga2V5ICs9IGAvJHtzdHJpbmdpZnkobGF5ZXJba10pfWA7XG4gICAgfVxuICAgIHJldHVybiBrZXk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGdyb3VwQnlMYXlvdXQ7XG5cbi8qKlxuICogR2l2ZW4gYW4gYXJyYXkgb2YgbGF5ZXJzLCByZXR1cm4gYW4gYXJyYXkgb2YgYXJyYXlzIG9mIGxheWVycyB3aGVyZSBhbGxcbiAqIGxheWVycyBpbiBlYWNoIGdyb3VwIGhhdmUgaWRlbnRpY2FsIGxheW91dC1hZmZlY3RpbmcgcHJvcGVydGllcy4gVGhlc2VcbiAqIGFyZSB0aGUgcHJvcGVydGllcyB0aGF0IHdlcmUgZm9ybWVybHkgdXNlZCBieSBleHBsaWNpdCBgcmVmYCBtZWNoYW5pc21cbiAqIGZvciBsYXllcnM6ICd0eXBlJywgJ3NvdXJjZScsICdzb3VyY2UtbGF5ZXInLCAnbWluem9vbScsICdtYXh6b29tJyxcbiAqICdmaWx0ZXInLCBhbmQgJ2xheW91dCcuXG4gKlxuICogVGhlIGlucHV0IGlzIG5vdCBtb2RpZmllZC4gVGhlIG91dHB1dCBsYXllcnMgYXJlIHJlZmVyZW5jZXMgdG8gdGhlXG4gKiBpbnB1dCBsYXllcnMuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7QXJyYXk8TGF5ZXI+fSBsYXllcnNcbiAqIEBwYXJhbSB7T2JqZWN0fSBbY2FjaGVkS2V5c10gLSBhbiBvYmplY3QgdG8ga2VlcCBhbHJlYWR5IGNhbGN1bGF0ZWQga2V5cy5cbiAqIEByZXR1cm5zIHtBcnJheTxBcnJheTxMYXllcj4+fVxuICovXG5mdW5jdGlvbiBncm91cEJ5TGF5b3V0KGxheWVycywgY2FjaGVkS2V5cykge1xuICAgIGNvbnN0IGdyb3VwcyA9IHt9O1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsYXllcnMubGVuZ3RoOyBpKyspIHtcblxuICAgICAgICBjb25zdCBrID0gKGNhY2hlZEtleXMgJiYgY2FjaGVkS2V5c1tsYXllcnNbaV0uaWRdKSB8fCBnZXRLZXkobGF5ZXJzW2ldKTtcbiAgICAgICAgLy8gdXBkYXRlIHRoZSBjYWNoZSBpZiB0aGVyZSBpcyBvbmVcbiAgICAgICAgaWYgKGNhY2hlZEtleXMpXG4gICAgICAgICAgICBjYWNoZWRLZXlzW2xheWVyc1tpXS5pZF0gPSBrO1xuXG4gICAgICAgIGxldCBncm91cCA9IGdyb3Vwc1trXTtcbiAgICAgICAgaWYgKCFncm91cCkge1xuICAgICAgICAgICAgZ3JvdXAgPSBncm91cHNba10gPSBbXTtcbiAgICAgICAgfVxuICAgICAgICBncm91cC5wdXNoKGxheWVyc1tpXSk7XG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0ID0gW107XG5cbiAgICBmb3IgKGNvbnN0IGsgaW4gZ3JvdXBzKSB7XG4gICAgICAgIHJlc3VsdC5wdXNoKGdyb3Vwc1trXSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cbiIsIi8vIEBmbG93XG5cbmltcG9ydCBTdHlsZUxheWVyIGZyb20gJy4vc3R5bGVfbGF5ZXInO1xuaW1wb3J0IGNyZWF0ZVN0eWxlTGF5ZXIgZnJvbSAnLi9jcmVhdGVfc3R5bGVfbGF5ZXInO1xuXG5pbXBvcnQge3ZhbHVlc30gZnJvbSAnLi4vdXRpbC91dGlsJztcbmltcG9ydCBmZWF0dXJlRmlsdGVyIGZyb20gJy4uL3N0eWxlLXNwZWMvZmVhdHVyZV9maWx0ZXInO1xuaW1wb3J0IGdyb3VwQnlMYXlvdXQgZnJvbSAnLi4vc3R5bGUtc3BlYy9ncm91cF9ieV9sYXlvdXQnO1xuXG5pbXBvcnQgdHlwZSB7VHlwZWRTdHlsZUxheWVyfSBmcm9tICcuL3N0eWxlX2xheWVyL3R5cGVkX3N0eWxlX2xheWVyJztcbmltcG9ydCB0eXBlIHtMYXllclNwZWNpZmljYXRpb259IGZyb20gJy4uL3N0eWxlLXNwZWMvdHlwZXMnO1xuXG5leHBvcnQgdHlwZSBMYXllckNvbmZpZ3MgPSB7W186IHN0cmluZ106IExheWVyU3BlY2lmaWNhdGlvbiB9O1xuZXhwb3J0IHR5cGUgRmFtaWx5PExheWVyOiBUeXBlZFN0eWxlTGF5ZXI+ID0gQXJyYXk8TGF5ZXI+O1xuXG5jbGFzcyBTdHlsZUxheWVySW5kZXgge1xuICAgIGZhbWlsaWVzQnlTb3VyY2U6IHsgW3NvdXJjZTogc3RyaW5nXTogeyBbc291cmNlTGF5ZXI6IHN0cmluZ106IEFycmF5PEZhbWlseTwqPj4gfSB9O1xuICAgIGtleUNhY2hlOiB7IFtzb3VyY2U6IHN0cmluZ106IHN0cmluZyB9O1xuXG4gICAgX2xheWVyQ29uZmlnczogTGF5ZXJDb25maWdzO1xuICAgIF9sYXllcnM6IHtbXzogc3RyaW5nXTogU3R5bGVMYXllciB9O1xuXG4gICAgY29uc3RydWN0b3IobGF5ZXJDb25maWdzOiA/QXJyYXk8TGF5ZXJTcGVjaWZpY2F0aW9uPikge1xuICAgICAgICB0aGlzLmtleUNhY2hlID0ge307XG4gICAgICAgIGlmIChsYXllckNvbmZpZ3MpIHtcbiAgICAgICAgICAgIHRoaXMucmVwbGFjZShsYXllckNvbmZpZ3MpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmVwbGFjZShsYXllckNvbmZpZ3M6IEFycmF5PExheWVyU3BlY2lmaWNhdGlvbj4pIHtcbiAgICAgICAgdGhpcy5fbGF5ZXJDb25maWdzID0ge307XG4gICAgICAgIHRoaXMuX2xheWVycyA9IHt9O1xuICAgICAgICB0aGlzLnVwZGF0ZShsYXllckNvbmZpZ3MsIFtdKTtcbiAgICB9XG5cbiAgICB1cGRhdGUobGF5ZXJDb25maWdzOiBBcnJheTxMYXllclNwZWNpZmljYXRpb24+LCByZW1vdmVkSWRzOiBBcnJheTxzdHJpbmc+KSB7XG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXJDb25maWcgb2YgbGF5ZXJDb25maWdzKSB7XG4gICAgICAgICAgICB0aGlzLl9sYXllckNvbmZpZ3NbbGF5ZXJDb25maWcuaWRdID0gbGF5ZXJDb25maWc7XG5cbiAgICAgICAgICAgIGNvbnN0IGxheWVyID0gdGhpcy5fbGF5ZXJzW2xheWVyQ29uZmlnLmlkXSA9IGNyZWF0ZVN0eWxlTGF5ZXIobGF5ZXJDb25maWcpO1xuICAgICAgICAgICAgbGF5ZXIuX2ZlYXR1cmVGaWx0ZXIgPSBmZWF0dXJlRmlsdGVyKGxheWVyLmZpbHRlcik7XG4gICAgICAgICAgICBpZiAodGhpcy5rZXlDYWNoZVtsYXllckNvbmZpZy5pZF0pXG4gICAgICAgICAgICAgICAgZGVsZXRlIHRoaXMua2V5Q2FjaGVbbGF5ZXJDb25maWcuaWRdO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgaWQgb2YgcmVtb3ZlZElkcykge1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMua2V5Q2FjaGVbaWRdO1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMuX2xheWVyQ29uZmlnc1tpZF07XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5fbGF5ZXJzW2lkXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuZmFtaWxpZXNCeVNvdXJjZSA9IHt9O1xuXG4gICAgICAgIGNvbnN0IGdyb3VwcyA9IGdyb3VwQnlMYXlvdXQodmFsdWVzKHRoaXMuX2xheWVyQ29uZmlncyksIHRoaXMua2V5Q2FjaGUpO1xuXG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXJDb25maWdzIG9mIGdyb3Vwcykge1xuICAgICAgICAgICAgY29uc3QgbGF5ZXJzID0gbGF5ZXJDb25maWdzLm1hcCgobGF5ZXJDb25maWcpID0+IHRoaXMuX2xheWVyc1tsYXllckNvbmZpZy5pZF0pO1xuXG4gICAgICAgICAgICBjb25zdCBsYXllciA9IGxheWVyc1swXTtcbiAgICAgICAgICAgIGlmIChsYXllci52aXNpYmlsaXR5ID09PSAnbm9uZScpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3Qgc291cmNlSWQgPSBsYXllci5zb3VyY2UgfHwgJyc7XG4gICAgICAgICAgICBsZXQgc291cmNlR3JvdXAgPSB0aGlzLmZhbWlsaWVzQnlTb3VyY2Vbc291cmNlSWRdO1xuICAgICAgICAgICAgaWYgKCFzb3VyY2VHcm91cCkge1xuICAgICAgICAgICAgICAgIHNvdXJjZUdyb3VwID0gdGhpcy5mYW1pbGllc0J5U291cmNlW3NvdXJjZUlkXSA9IHt9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBzb3VyY2VMYXllcklkID0gbGF5ZXIuc291cmNlTGF5ZXIgfHwgJ19nZW9qc29uVGlsZUxheWVyJztcbiAgICAgICAgICAgIGxldCBzb3VyY2VMYXllckZhbWlsaWVzID0gc291cmNlR3JvdXBbc291cmNlTGF5ZXJJZF07XG4gICAgICAgICAgICBpZiAoIXNvdXJjZUxheWVyRmFtaWxpZXMpIHtcbiAgICAgICAgICAgICAgICBzb3VyY2VMYXllckZhbWlsaWVzID0gc291cmNlR3JvdXBbc291cmNlTGF5ZXJJZF0gPSBbXTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc291cmNlTGF5ZXJGYW1pbGllcy5wdXNoKGxheWVycyk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFN0eWxlTGF5ZXJJbmRleDtcbiIsIi8vIEBmbG93XG5cbmltcG9ydCB7QWxwaGFJbWFnZX0gZnJvbSAnLi4vdXRpbC9pbWFnZSc7XG5pbXBvcnQge3JlZ2lzdGVyfSBmcm9tICcuLi91dGlsL3dlYl93b3JrZXJfdHJhbnNmZXInO1xuaW1wb3J0IHBvdHBhY2sgZnJvbSAncG90cGFjayc7XG5cbmltcG9ydCB0eXBlIHtHbHlwaE1ldHJpY3MsIFN0eWxlR2x5cGh9IGZyb20gJy4uL3N0eWxlL3N0eWxlX2dseXBoJztcblxuY29uc3QgcGFkZGluZyA9IDE7XG5cbmV4cG9ydCB0eXBlIFJlY3QgPSB7XG4gICAgeDogbnVtYmVyLFxuICAgIHk6IG51bWJlcixcbiAgICB3OiBudW1iZXIsXG4gICAgaDogbnVtYmVyXG59O1xuXG5leHBvcnQgdHlwZSBHbHlwaFBvc2l0aW9uID0ge1xuICAgIHJlY3Q6IFJlY3QsXG4gICAgbWV0cmljczogR2x5cGhNZXRyaWNzXG59O1xuXG5leHBvcnQgdHlwZSBHbHlwaFBvc2l0aW9ucyA9IHtbXzogc3RyaW5nXToge1tfOiBudW1iZXJdOiBHbHlwaFBvc2l0aW9uIH0gfVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBHbHlwaEF0bGFzIHtcbiAgICBpbWFnZTogQWxwaGFJbWFnZTtcbiAgICBwb3NpdGlvbnM6IEdseXBoUG9zaXRpb25zO1xuXG4gICAgY29uc3RydWN0b3Ioc3RhY2tzOiB7W186IHN0cmluZ106IHtbXzogbnVtYmVyXTogP1N0eWxlR2x5cGggfSB9KSB7XG4gICAgICAgIGNvbnN0IHBvc2l0aW9ucyA9IHt9O1xuICAgICAgICBjb25zdCBiaW5zID0gW107XG5cbiAgICAgICAgZm9yIChjb25zdCBzdGFjayBpbiBzdGFja3MpIHtcbiAgICAgICAgICAgIGNvbnN0IGdseXBocyA9IHN0YWNrc1tzdGFja107XG4gICAgICAgICAgICBjb25zdCBzdGFja1Bvc2l0aW9ucyA9IHBvc2l0aW9uc1tzdGFja10gPSB7fTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCBpZCBpbiBnbHlwaHMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzcmMgPSBnbHlwaHNbK2lkXTtcbiAgICAgICAgICAgICAgICBpZiAoIXNyYyB8fCBzcmMuYml0bWFwLndpZHRoID09PSAwIHx8IHNyYy5iaXRtYXAuaGVpZ2h0ID09PSAwKSBjb250aW51ZTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IGJpbiA9IHtcbiAgICAgICAgICAgICAgICAgICAgeDogMCxcbiAgICAgICAgICAgICAgICAgICAgeTogMCxcbiAgICAgICAgICAgICAgICAgICAgdzogc3JjLmJpdG1hcC53aWR0aCArIDIgKiBwYWRkaW5nLFxuICAgICAgICAgICAgICAgICAgICBoOiBzcmMuYml0bWFwLmhlaWdodCArIDIgKiBwYWRkaW5nXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBiaW5zLnB1c2goYmluKTtcbiAgICAgICAgICAgICAgICBzdGFja1Bvc2l0aW9uc1tpZF0gPSB7cmVjdDogYmluLCBtZXRyaWNzOiBzcmMubWV0cmljc307XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB7dywgaH0gPSBwb3RwYWNrKGJpbnMpO1xuICAgICAgICBjb25zdCBpbWFnZSA9IG5ldyBBbHBoYUltYWdlKHt3aWR0aDogdyB8fCAxLCBoZWlnaHQ6IGggfHwgMX0pO1xuXG4gICAgICAgIGZvciAoY29uc3Qgc3RhY2sgaW4gc3RhY2tzKSB7XG4gICAgICAgICAgICBjb25zdCBnbHlwaHMgPSBzdGFja3Nbc3RhY2tdO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGlkIGluIGdseXBocykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHNyYyA9IGdseXBoc1sraWRdO1xuICAgICAgICAgICAgICAgIGlmICghc3JjIHx8IHNyYy5iaXRtYXAud2lkdGggPT09IDAgfHwgc3JjLmJpdG1hcC5oZWlnaHQgPT09IDApIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIGNvbnN0IGJpbiA9IHBvc2l0aW9uc1tzdGFja11baWRdLnJlY3Q7XG4gICAgICAgICAgICAgICAgQWxwaGFJbWFnZS5jb3B5KHNyYy5iaXRtYXAsIGltYWdlLCB7eDogMCwgeTogMH0sIHt4OiBiaW4ueCArIHBhZGRpbmcsIHk6IGJpbi55ICsgcGFkZGluZ30sIHNyYy5iaXRtYXApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5pbWFnZSA9IGltYWdlO1xuICAgICAgICB0aGlzLnBvc2l0aW9ucyA9IHBvc2l0aW9ucztcbiAgICB9XG59XG5cbnJlZ2lzdGVyKCdHbHlwaEF0bGFzJywgR2x5cGhBdGxhcyk7XG4iLCIvLyBAZmxvd1xuXG5pbXBvcnQgRmVhdHVyZUluZGV4IGZyb20gJy4uL2RhdGEvZmVhdHVyZV9pbmRleCc7XG5cbmltcG9ydCB7cGVyZm9ybVN5bWJvbExheW91dH0gZnJvbSAnLi4vc3ltYm9sL3N5bWJvbF9sYXlvdXQnO1xuaW1wb3J0IHtDb2xsaXNpb25Cb3hBcnJheX0gZnJvbSAnLi4vZGF0YS9hcnJheV90eXBlcyc7XG5pbXBvcnQgRGljdGlvbmFyeUNvZGVyIGZyb20gJy4uL3V0aWwvZGljdGlvbmFyeV9jb2Rlcic7XG5pbXBvcnQgU3ltYm9sQnVja2V0IGZyb20gJy4uL2RhdGEvYnVja2V0L3N5bWJvbF9idWNrZXQnO1xuaW1wb3J0IExpbmVCdWNrZXQgZnJvbSAnLi4vZGF0YS9idWNrZXQvbGluZV9idWNrZXQnO1xuaW1wb3J0IEZpbGxCdWNrZXQgZnJvbSAnLi4vZGF0YS9idWNrZXQvZmlsbF9idWNrZXQnO1xuaW1wb3J0IEZpbGxFeHRydXNpb25CdWNrZXQgZnJvbSAnLi4vZGF0YS9idWNrZXQvZmlsbF9leHRydXNpb25fYnVja2V0JztcbmltcG9ydCB7d2Fybk9uY2UsIG1hcE9iamVjdCwgdmFsdWVzfSBmcm9tICcuLi91dGlsL3V0aWwnO1xuaW1wb3J0IGFzc2VydCBmcm9tICdhc3NlcnQnO1xuaW1wb3J0IEltYWdlQXRsYXMgZnJvbSAnLi4vcmVuZGVyL2ltYWdlX2F0bGFzJztcbmltcG9ydCBHbHlwaEF0bGFzIGZyb20gJy4uL3JlbmRlci9nbHlwaF9hdGxhcyc7XG5pbXBvcnQgRXZhbHVhdGlvblBhcmFtZXRlcnMgZnJvbSAnLi4vc3R5bGUvZXZhbHVhdGlvbl9wYXJhbWV0ZXJzJztcbmltcG9ydCB7T3ZlcnNjYWxlZFRpbGVJRH0gZnJvbSAnLi90aWxlX2lkJztcblxuaW1wb3J0IHR5cGUge0J1Y2tldH0gZnJvbSAnLi4vZGF0YS9idWNrZXQnO1xuaW1wb3J0IHR5cGUgQWN0b3IgZnJvbSAnLi4vdXRpbC9hY3Rvcic7XG5pbXBvcnQgdHlwZSBTdHlsZUxheWVyIGZyb20gJy4uL3N0eWxlL3N0eWxlX2xheWVyJztcbmltcG9ydCB0eXBlIFN0eWxlTGF5ZXJJbmRleCBmcm9tICcuLi9zdHlsZS9zdHlsZV9sYXllcl9pbmRleCc7XG5pbXBvcnQgdHlwZSB7U3R5bGVJbWFnZX0gZnJvbSAnLi4vc3R5bGUvc3R5bGVfaW1hZ2UnO1xuaW1wb3J0IHR5cGUge1N0eWxlR2x5cGh9IGZyb20gJy4uL3N0eWxlL3N0eWxlX2dseXBoJztcbmltcG9ydCB0eXBlIHtcbiAgICBXb3JrZXJUaWxlUGFyYW1ldGVycyxcbiAgICBXb3JrZXJUaWxlQ2FsbGJhY2ssXG59IGZyb20gJy4uL3NvdXJjZS93b3JrZXJfc291cmNlJztcbmltcG9ydCB0eXBlIHtQcm9tb3RlSWRTcGVjaWZpY2F0aW9ufSBmcm9tICcuLi9zdHlsZS1zcGVjL3R5cGVzJztcblxuY2xhc3MgV29ya2VyVGlsZSB7XG4gICAgdGlsZUlEOiBPdmVyc2NhbGVkVGlsZUlEO1xuICAgIHVpZDogc3RyaW5nO1xuICAgIHpvb206IG51bWJlcjtcbiAgICBwaXhlbFJhdGlvOiBudW1iZXI7XG4gICAgdGlsZVNpemU6IG51bWJlcjtcbiAgICBzb3VyY2U6IHN0cmluZztcbiAgICBwcm9tb3RlSWQ6ID9Qcm9tb3RlSWRTcGVjaWZpY2F0aW9uO1xuICAgIG92ZXJzY2FsaW5nOiBudW1iZXI7XG4gICAgc2hvd0NvbGxpc2lvbkJveGVzOiBib29sZWFuO1xuICAgIGNvbGxlY3RSZXNvdXJjZVRpbWluZzogYm9vbGVhbjtcbiAgICByZXR1cm5EZXBlbmRlbmNpZXM6IGJvb2xlYW47XG5cbiAgICBzdGF0dXM6ICdwYXJzaW5nJyB8ICdkb25lJztcbiAgICBkYXRhOiBWZWN0b3JUaWxlO1xuICAgIGNvbGxpc2lvbkJveEFycmF5OiBDb2xsaXNpb25Cb3hBcnJheTtcblxuICAgIGFib3J0OiA/KCkgPT4gdm9pZDtcbiAgICByZWxvYWRDYWxsYmFjazogV29ya2VyVGlsZUNhbGxiYWNrO1xuICAgIHZlY3RvclRpbGU6IFZlY3RvclRpbGU7XG5cbiAgICBjb25zdHJ1Y3RvcihwYXJhbXM6IFdvcmtlclRpbGVQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHRoaXMudGlsZUlEID0gbmV3IE92ZXJzY2FsZWRUaWxlSUQocGFyYW1zLnRpbGVJRC5vdmVyc2NhbGVkWiwgcGFyYW1zLnRpbGVJRC53cmFwLCBwYXJhbXMudGlsZUlELmNhbm9uaWNhbC56LCBwYXJhbXMudGlsZUlELmNhbm9uaWNhbC54LCBwYXJhbXMudGlsZUlELmNhbm9uaWNhbC55KTtcbiAgICAgICAgdGhpcy51aWQgPSBwYXJhbXMudWlkO1xuICAgICAgICB0aGlzLnpvb20gPSBwYXJhbXMuem9vbTtcbiAgICAgICAgdGhpcy5waXhlbFJhdGlvID0gcGFyYW1zLnBpeGVsUmF0aW87XG4gICAgICAgIHRoaXMudGlsZVNpemUgPSBwYXJhbXMudGlsZVNpemU7XG4gICAgICAgIHRoaXMuc291cmNlID0gcGFyYW1zLnNvdXJjZTtcbiAgICAgICAgdGhpcy5vdmVyc2NhbGluZyA9IHRoaXMudGlsZUlELm92ZXJzY2FsZUZhY3RvcigpO1xuICAgICAgICB0aGlzLnNob3dDb2xsaXNpb25Cb3hlcyA9IHBhcmFtcy5zaG93Q29sbGlzaW9uQm94ZXM7XG4gICAgICAgIHRoaXMuY29sbGVjdFJlc291cmNlVGltaW5nID0gISFwYXJhbXMuY29sbGVjdFJlc291cmNlVGltaW5nO1xuICAgICAgICB0aGlzLnJldHVybkRlcGVuZGVuY2llcyA9ICEhcGFyYW1zLnJldHVybkRlcGVuZGVuY2llcztcbiAgICAgICAgdGhpcy5wcm9tb3RlSWQgPSBwYXJhbXMucHJvbW90ZUlkO1xuICAgIH1cblxuICAgIHBhcnNlKGRhdGE6IFZlY3RvclRpbGUsIGxheWVySW5kZXg6IFN0eWxlTGF5ZXJJbmRleCwgYXZhaWxhYmxlSW1hZ2VzOiBBcnJheTxzdHJpbmc+LCBhY3RvcjogQWN0b3IsIGNhbGxiYWNrOiBXb3JrZXJUaWxlQ2FsbGJhY2spIHtcbiAgICAgICAgdGhpcy5zdGF0dXMgPSAncGFyc2luZyc7XG4gICAgICAgIHRoaXMuZGF0YSA9IGRhdGE7XG5cbiAgICAgICAgdGhpcy5jb2xsaXNpb25Cb3hBcnJheSA9IG5ldyBDb2xsaXNpb25Cb3hBcnJheSgpO1xuICAgICAgICBjb25zdCBzb3VyY2VMYXllckNvZGVyID0gbmV3IERpY3Rpb25hcnlDb2RlcihPYmplY3Qua2V5cyhkYXRhLmxheWVycykuc29ydCgpKTtcblxuICAgICAgICBjb25zdCBmZWF0dXJlSW5kZXggPSBuZXcgRmVhdHVyZUluZGV4KHRoaXMudGlsZUlELCB0aGlzLnByb21vdGVJZCk7XG4gICAgICAgIGZlYXR1cmVJbmRleC5idWNrZXRMYXllcklEcyA9IFtdO1xuXG4gICAgICAgIGNvbnN0IGJ1Y2tldHM6IHtbXzogc3RyaW5nXTogQnVja2V0fSA9IHt9O1xuXG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7XG4gICAgICAgICAgICBmZWF0dXJlSW5kZXgsXG4gICAgICAgICAgICBpY29uRGVwZW5kZW5jaWVzOiB7fSxcbiAgICAgICAgICAgIHBhdHRlcm5EZXBlbmRlbmNpZXM6IHt9LFxuICAgICAgICAgICAgZ2x5cGhEZXBlbmRlbmNpZXM6IHt9LFxuICAgICAgICAgICAgYXZhaWxhYmxlSW1hZ2VzXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgbGF5ZXJGYW1pbGllcyA9IGxheWVySW5kZXguZmFtaWxpZXNCeVNvdXJjZVt0aGlzLnNvdXJjZV07XG4gICAgICAgIGZvciAoY29uc3Qgc291cmNlTGF5ZXJJZCBpbiBsYXllckZhbWlsaWVzKSB7XG4gICAgICAgICAgICBjb25zdCBzb3VyY2VMYXllciA9IGRhdGEubGF5ZXJzW3NvdXJjZUxheWVySWRdO1xuICAgICAgICAgICAgaWYgKCFzb3VyY2VMYXllcikge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoc291cmNlTGF5ZXIudmVyc2lvbiA9PT0gMSkge1xuICAgICAgICAgICAgICAgIHdhcm5PbmNlKGBWZWN0b3IgdGlsZSBzb3VyY2UgXCIke3RoaXMuc291cmNlfVwiIGxheWVyIFwiJHtzb3VyY2VMYXllcklkfVwiIGAgK1xuICAgICAgICAgICAgICAgICAgICBgZG9lcyBub3QgdXNlIHZlY3RvciB0aWxlIHNwZWMgdjIgYW5kIHRoZXJlZm9yZSBtYXkgaGF2ZSBzb21lIHJlbmRlcmluZyBlcnJvcnMuYCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHNvdXJjZUxheWVySW5kZXggPSBzb3VyY2VMYXllckNvZGVyLmVuY29kZShzb3VyY2VMYXllcklkKTtcbiAgICAgICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XG4gICAgICAgICAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgc291cmNlTGF5ZXIubGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZmVhdHVyZSA9IHNvdXJjZUxheWVyLmZlYXR1cmUoaW5kZXgpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkID0gZmVhdHVyZUluZGV4LmdldElkKGZlYXR1cmUsIHNvdXJjZUxheWVySWQpO1xuICAgICAgICAgICAgICAgIGZlYXR1cmVzLnB1c2goe2ZlYXR1cmUsIGlkLCBpbmRleCwgc291cmNlTGF5ZXJJbmRleH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGZhbWlseSBvZiBsYXllckZhbWlsaWVzW3NvdXJjZUxheWVySWRdKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmYW1pbHlbMF07XG5cbiAgICAgICAgICAgICAgICBhc3NlcnQobGF5ZXIuc291cmNlID09PSB0aGlzLnNvdXJjZSk7XG4gICAgICAgICAgICAgICAgaWYgKGxheWVyLm1pbnpvb20gJiYgdGhpcy56b29tIDwgTWF0aC5mbG9vcihsYXllci5taW56b29tKSkgY29udGludWU7XG4gICAgICAgICAgICAgICAgaWYgKGxheWVyLm1heHpvb20gJiYgdGhpcy56b29tID49IGxheWVyLm1heHpvb20pIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIGlmIChsYXllci52aXNpYmlsaXR5ID09PSAnbm9uZScpIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICAgICAgcmVjYWxjdWxhdGVMYXllcnMoZmFtaWx5LCB0aGlzLnpvb20sIGF2YWlsYWJsZUltYWdlcyk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBidWNrZXQgPSBidWNrZXRzW2xheWVyLmlkXSA9IGxheWVyLmNyZWF0ZUJ1Y2tldCh7XG4gICAgICAgICAgICAgICAgICAgIGluZGV4OiBmZWF0dXJlSW5kZXguYnVja2V0TGF5ZXJJRHMubGVuZ3RoLFxuICAgICAgICAgICAgICAgICAgICBsYXllcnM6IGZhbWlseSxcbiAgICAgICAgICAgICAgICAgICAgem9vbTogdGhpcy56b29tLFxuICAgICAgICAgICAgICAgICAgICBwaXhlbFJhdGlvOiB0aGlzLnBpeGVsUmF0aW8sXG4gICAgICAgICAgICAgICAgICAgIG92ZXJzY2FsaW5nOiB0aGlzLm92ZXJzY2FsaW5nLFxuICAgICAgICAgICAgICAgICAgICBjb2xsaXNpb25Cb3hBcnJheTogdGhpcy5jb2xsaXNpb25Cb3hBcnJheSxcbiAgICAgICAgICAgICAgICAgICAgc291cmNlTGF5ZXJJbmRleCxcbiAgICAgICAgICAgICAgICAgICAgc291cmNlSUQ6IHRoaXMuc291cmNlXG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBidWNrZXQucG9wdWxhdGUoZmVhdHVyZXMsIG9wdGlvbnMsIHRoaXMudGlsZUlELmNhbm9uaWNhbCk7XG4gICAgICAgICAgICAgICAgZmVhdHVyZUluZGV4LmJ1Y2tldExheWVySURzLnB1c2goZmFtaWx5Lm1hcCgobCkgPT4gbC5pZCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgbGV0IGVycm9yOiA/RXJyb3I7XG4gICAgICAgIGxldCBnbHlwaE1hcDogP3tbXzogc3RyaW5nXToge1tfOiBudW1iZXJdOiA/U3R5bGVHbHlwaH19O1xuICAgICAgICBsZXQgaWNvbk1hcDogP3tbXzogc3RyaW5nXTogU3R5bGVJbWFnZX07XG4gICAgICAgIGxldCBwYXR0ZXJuTWFwOiA/e1tfOiBzdHJpbmddOiBTdHlsZUltYWdlfTtcblxuICAgICAgICBjb25zdCBzdGFja3MgPSBtYXBPYmplY3Qob3B0aW9ucy5nbHlwaERlcGVuZGVuY2llcywgKGdseXBocykgPT4gT2JqZWN0LmtleXMoZ2x5cGhzKS5tYXAoTnVtYmVyKSk7XG4gICAgICAgIGlmIChPYmplY3Qua2V5cyhzdGFja3MpLmxlbmd0aCkge1xuICAgICAgICAgICAgYWN0b3Iuc2VuZCgnZ2V0R2x5cGhzJywge3VpZDogdGhpcy51aWQsIHN0YWNrc30sIChlcnIsIHJlc3VsdCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICghZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgZXJyb3IgPSBlcnI7XG4gICAgICAgICAgICAgICAgICAgIGdseXBoTWFwID0gcmVzdWx0O1xuICAgICAgICAgICAgICAgICAgICBtYXliZVByZXBhcmUuY2FsbCh0aGlzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGdseXBoTWFwID0ge307XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBpY29ucyA9IE9iamVjdC5rZXlzKG9wdGlvbnMuaWNvbkRlcGVuZGVuY2llcyk7XG4gICAgICAgIGlmIChpY29ucy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGFjdG9yLnNlbmQoJ2dldEltYWdlcycsIHtpY29ucywgc291cmNlOiB0aGlzLnNvdXJjZSwgdGlsZUlEOiB0aGlzLnRpbGVJRCwgdHlwZTogJ2ljb25zJ30sIChlcnIsIHJlc3VsdCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICghZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgZXJyb3IgPSBlcnI7XG4gICAgICAgICAgICAgICAgICAgIGljb25NYXAgPSByZXN1bHQ7XG4gICAgICAgICAgICAgICAgICAgIG1heWJlUHJlcGFyZS5jYWxsKHRoaXMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWNvbk1hcCA9IHt9O1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcGF0dGVybnMgPSBPYmplY3Qua2V5cyhvcHRpb25zLnBhdHRlcm5EZXBlbmRlbmNpZXMpO1xuICAgICAgICBpZiAocGF0dGVybnMubGVuZ3RoKSB7XG4gICAgICAgICAgICBhY3Rvci5zZW5kKCdnZXRJbWFnZXMnLCB7aWNvbnM6IHBhdHRlcm5zLCBzb3VyY2U6IHRoaXMuc291cmNlLCB0aWxlSUQ6IHRoaXMudGlsZUlELCB0eXBlOiAncGF0dGVybnMnfSwgKGVyciwgcmVzdWx0KSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCFlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICBlcnJvciA9IGVycjtcbiAgICAgICAgICAgICAgICAgICAgcGF0dGVybk1hcCA9IHJlc3VsdDtcbiAgICAgICAgICAgICAgICAgICAgbWF5YmVQcmVwYXJlLmNhbGwodGhpcyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBwYXR0ZXJuTWFwID0ge307XG4gICAgICAgIH1cblxuICAgICAgICBtYXliZVByZXBhcmUuY2FsbCh0aGlzKTtcblxuICAgICAgICBmdW5jdGlvbiBtYXliZVByZXBhcmUoKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChnbHlwaE1hcCAmJiBpY29uTWFwICYmIHBhdHRlcm5NYXApIHtcbiAgICAgICAgICAgICAgICBjb25zdCBnbHlwaEF0bGFzID0gbmV3IEdseXBoQXRsYXMoZ2x5cGhNYXApO1xuICAgICAgICAgICAgICAgIGNvbnN0IGltYWdlQXRsYXMgPSBuZXcgSW1hZ2VBdGxhcyhpY29uTWFwLCBwYXR0ZXJuTWFwKTtcblxuICAgICAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIGJ1Y2tldHMpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYnVja2V0ID0gYnVja2V0c1trZXldO1xuICAgICAgICAgICAgICAgICAgICBpZiAoYnVja2V0IGluc3RhbmNlb2YgU3ltYm9sQnVja2V0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZWNhbGN1bGF0ZUxheWVycyhidWNrZXQubGF5ZXJzLCB0aGlzLnpvb20sIGF2YWlsYWJsZUltYWdlcyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBwZXJmb3JtU3ltYm9sTGF5b3V0KGJ1Y2tldCwgZ2x5cGhNYXAsIGdseXBoQXRsYXMucG9zaXRpb25zLCBpY29uTWFwLCBpbWFnZUF0bGFzLmljb25Qb3NpdGlvbnMsIHRoaXMuc2hvd0NvbGxpc2lvbkJveGVzLCB0aGlzLnRpbGVJRC5jYW5vbmljYWwpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGJ1Y2tldC5oYXNQYXR0ZXJuICYmXG4gICAgICAgICAgICAgICAgICAgICAgICAoYnVja2V0IGluc3RhbmNlb2YgTGluZUJ1Y2tldCB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgIGJ1Y2tldCBpbnN0YW5jZW9mIEZpbGxCdWNrZXQgfHxcbiAgICAgICAgICAgICAgICAgICAgICAgICBidWNrZXQgaW5zdGFuY2VvZiBGaWxsRXh0cnVzaW9uQnVja2V0KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVjYWxjdWxhdGVMYXllcnMoYnVja2V0LmxheWVycywgdGhpcy56b29tLCBhdmFpbGFibGVJbWFnZXMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnVja2V0LmFkZEZlYXR1cmVzKG9wdGlvbnMsIHRoaXMudGlsZUlELmNhbm9uaWNhbCwgaW1hZ2VBdGxhcy5wYXR0ZXJuUG9zaXRpb25zKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHRoaXMuc3RhdHVzID0gJ2RvbmUnO1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHtcbiAgICAgICAgICAgICAgICAgICAgYnVja2V0czogdmFsdWVzKGJ1Y2tldHMpLmZpbHRlcihiID0+ICFiLmlzRW1wdHkoKSksXG4gICAgICAgICAgICAgICAgICAgIGZlYXR1cmVJbmRleCxcbiAgICAgICAgICAgICAgICAgICAgY29sbGlzaW9uQm94QXJyYXk6IHRoaXMuY29sbGlzaW9uQm94QXJyYXksXG4gICAgICAgICAgICAgICAgICAgIGdseXBoQXRsYXNJbWFnZTogZ2x5cGhBdGxhcy5pbWFnZSxcbiAgICAgICAgICAgICAgICAgICAgaW1hZ2VBdGxhcyxcbiAgICAgICAgICAgICAgICAgICAgLy8gT25seSB1c2VkIGZvciBiZW5jaG1hcmtpbmc6XG4gICAgICAgICAgICAgICAgICAgIGdseXBoTWFwOiB0aGlzLnJldHVybkRlcGVuZGVuY2llcyA/IGdseXBoTWFwIDogbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgaWNvbk1hcDogdGhpcy5yZXR1cm5EZXBlbmRlbmNpZXMgPyBpY29uTWFwIDogbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgZ2x5cGhQb3NpdGlvbnM6IHRoaXMucmV0dXJuRGVwZW5kZW5jaWVzID8gZ2x5cGhBdGxhcy5wb3NpdGlvbnMgOiBudWxsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHJlY2FsY3VsYXRlTGF5ZXJzKGxheWVyczogJFJlYWRPbmx5QXJyYXk8U3R5bGVMYXllcj4sIHpvb206IG51bWJlciwgYXZhaWxhYmxlSW1hZ2VzOiBBcnJheTxzdHJpbmc+KSB7XG4gICAgLy8gTGF5ZXJzIGFyZSBzaGFyZWQgYW5kIG1heSBoYXZlIGJlZW4gdXNlZCBieSBhIFdvcmtlclRpbGUgd2l0aCBhIGRpZmZlcmVudCB6b29tLlxuICAgIGNvbnN0IHBhcmFtZXRlcnMgPSBuZXcgRXZhbHVhdGlvblBhcmFtZXRlcnMoem9vbSk7XG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMpIHtcbiAgICAgICAgbGF5ZXIucmVjYWxjdWxhdGUocGFyYW1ldGVycywgYXZhaWxhYmxlSW1hZ2VzKTtcbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFdvcmtlclRpbGU7XG4iLCIvLyBAZmxvd1xuXG5pbXBvcnQge2dldEFycmF5QnVmZmVyfSBmcm9tICcuLi91dGlsL2FqYXgnO1xuXG5pbXBvcnQgdnQgZnJvbSAnQG1hcGJveC92ZWN0b3ItdGlsZSc7XG5pbXBvcnQgUHJvdG9idWYgZnJvbSAncGJmJztcbmltcG9ydCBXb3JrZXJUaWxlIGZyb20gJy4vd29ya2VyX3RpbGUnO1xuaW1wb3J0IHtleHRlbmR9IGZyb20gJy4uL3V0aWwvdXRpbCc7XG5pbXBvcnQge1JlcXVlc3RQZXJmb3JtYW5jZX0gZnJvbSAnLi4vdXRpbC9wZXJmb3JtYW5jZSc7XG5cbmltcG9ydCB0eXBlIHtcbiAgICBXb3JrZXJTb3VyY2UsXG4gICAgV29ya2VyVGlsZVBhcmFtZXRlcnMsXG4gICAgV29ya2VyVGlsZUNhbGxiYWNrLFxuICAgIFRpbGVQYXJhbWV0ZXJzXG59IGZyb20gJy4uL3NvdXJjZS93b3JrZXJfc291cmNlJztcblxuaW1wb3J0IHR5cGUgQWN0b3IgZnJvbSAnLi4vdXRpbC9hY3Rvcic7XG5pbXBvcnQgdHlwZSBTdHlsZUxheWVySW5kZXggZnJvbSAnLi4vc3R5bGUvc3R5bGVfbGF5ZXJfaW5kZXgnO1xuaW1wb3J0IHR5cGUge0NhbGxiYWNrfSBmcm9tICcuLi90eXBlcy9jYWxsYmFjayc7XG5cbmV4cG9ydCB0eXBlIExvYWRWZWN0b3JUaWxlUmVzdWx0ID0ge1xuICAgIHZlY3RvclRpbGU6IFZlY3RvclRpbGU7XG4gICAgcmF3RGF0YTogQXJyYXlCdWZmZXI7XG4gICAgZXhwaXJlcz86IGFueTtcbiAgICBjYWNoZUNvbnRyb2w/OiBhbnk7XG4gICAgcmVzb3VyY2VUaW1pbmc/OiBBcnJheTxQZXJmb3JtYW5jZVJlc291cmNlVGltaW5nPjtcbn07XG5cbi8qKlxuICogQGNhbGxiYWNrIExvYWRWZWN0b3JEYXRhQ2FsbGJhY2tcbiAqIEBwYXJhbSBlcnJvclxuICogQHBhcmFtIHZlY3RvclRpbGVcbiAqIEBwcml2YXRlXG4gKi9cbmV4cG9ydCB0eXBlIExvYWRWZWN0b3JEYXRhQ2FsbGJhY2sgPSBDYWxsYmFjazw/TG9hZFZlY3RvclRpbGVSZXN1bHQ+O1xuXG5leHBvcnQgdHlwZSBBYm9ydFZlY3RvckRhdGEgPSAoKSA9PiB2b2lkO1xuZXhwb3J0IHR5cGUgTG9hZFZlY3RvckRhdGEgPSAocGFyYW1zOiBXb3JrZXJUaWxlUGFyYW1ldGVycywgY2FsbGJhY2s6IExvYWRWZWN0b3JEYXRhQ2FsbGJhY2spID0+ID9BYm9ydFZlY3RvckRhdGE7XG5cbi8qKlxuICogQHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gbG9hZFZlY3RvclRpbGUocGFyYW1zOiBXb3JrZXJUaWxlUGFyYW1ldGVycywgY2FsbGJhY2s6IExvYWRWZWN0b3JEYXRhQ2FsbGJhY2spIHtcbiAgICBjb25zdCByZXF1ZXN0ID0gZ2V0QXJyYXlCdWZmZXIocGFyYW1zLnJlcXVlc3QsIChlcnI6ID9FcnJvciwgZGF0YTogP0FycmF5QnVmZmVyLCBjYWNoZUNvbnRyb2w6ID9zdHJpbmcsIGV4cGlyZXM6ID9zdHJpbmcpID0+IHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgICAgfSBlbHNlIGlmIChkYXRhKSB7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCB7XG4gICAgICAgICAgICAgICAgdmVjdG9yVGlsZTogbmV3IHZ0LlZlY3RvclRpbGUobmV3IFByb3RvYnVmKGRhdGEpKSxcbiAgICAgICAgICAgICAgICByYXdEYXRhOiBkYXRhLFxuICAgICAgICAgICAgICAgIGNhY2hlQ29udHJvbCxcbiAgICAgICAgICAgICAgICBleHBpcmVzXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgIHJlcXVlc3QuY2FuY2VsKCk7XG4gICAgICAgIGNhbGxiYWNrKCk7XG4gICAgfTtcbn1cblxuLyoqXG4gKiBUaGUge0BsaW5rIFdvcmtlclNvdXJjZX0gaW1wbGVtZW50YXRpb24gdGhhdCBzdXBwb3J0cyB7QGxpbmsgVmVjdG9yVGlsZVNvdXJjZX0uXG4gKiBUaGlzIGNsYXNzIGlzIGRlc2lnbmVkIHRvIGJlIGVhc2lseSByZXVzZWQgdG8gc3VwcG9ydCBjdXN0b20gc291cmNlIHR5cGVzXG4gKiBmb3IgZGF0YSBmb3JtYXRzIHRoYXQgY2FuIGJlIHBhcnNlZC9jb252ZXJ0ZWQgaW50byBhbiBpbi1tZW1vcnkgVmVjdG9yVGlsZVxuICogcmVwcmVzZW50YXRpb24uICBUbyBkbyBzbywgY3JlYXRlIGl0IHdpdGhcbiAqIGBuZXcgVmVjdG9yVGlsZVdvcmtlclNvdXJjZShhY3Rvciwgc3R5bGVMYXllcnMsIGN1c3RvbUxvYWRWZWN0b3JEYXRhRnVuY3Rpb24pYC5cbiAqXG4gKiBAcHJpdmF0ZVxuICovXG5jbGFzcyBWZWN0b3JUaWxlV29ya2VyU291cmNlIGltcGxlbWVudHMgV29ya2VyU291cmNlIHtcbiAgICBhY3RvcjogQWN0b3I7XG4gICAgbGF5ZXJJbmRleDogU3R5bGVMYXllckluZGV4O1xuICAgIGF2YWlsYWJsZUltYWdlczogQXJyYXk8c3RyaW5nPjtcbiAgICBsb2FkVmVjdG9yRGF0YTogTG9hZFZlY3RvckRhdGE7XG4gICAgbG9hZGluZzoge1tfOiBzdHJpbmddOiBXb3JrZXJUaWxlIH07XG4gICAgbG9hZGVkOiB7W186IHN0cmluZ106IFdvcmtlclRpbGUgfTtcblxuICAgIC8qKlxuICAgICAqIEBwYXJhbSBbbG9hZFZlY3RvckRhdGFdIE9wdGlvbmFsIG1ldGhvZCBmb3IgY3VzdG9tIGxvYWRpbmcgb2YgYSBWZWN0b3JUaWxlXG4gICAgICogb2JqZWN0IGJhc2VkIG9uIHBhcmFtZXRlcnMgcGFzc2VkIGZyb20gdGhlIG1haW4tdGhyZWFkIFNvdXJjZS4gU2VlXG4gICAgICoge0BsaW5rIFZlY3RvclRpbGVXb3JrZXJTb3VyY2UjbG9hZFRpbGV9LiBUaGUgZGVmYXVsdCBpbXBsZW1lbnRhdGlvbiBzaW1wbHlcbiAgICAgKiBsb2FkcyB0aGUgcGJmIGF0IGBwYXJhbXMudXJsYC5cbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKGFjdG9yOiBBY3RvciwgbGF5ZXJJbmRleDogU3R5bGVMYXllckluZGV4LCBhdmFpbGFibGVJbWFnZXM6IEFycmF5PHN0cmluZz4sIGxvYWRWZWN0b3JEYXRhOiA/TG9hZFZlY3RvckRhdGEpIHtcbiAgICAgICAgdGhpcy5hY3RvciA9IGFjdG9yO1xuICAgICAgICB0aGlzLmxheWVySW5kZXggPSBsYXllckluZGV4O1xuICAgICAgICB0aGlzLmF2YWlsYWJsZUltYWdlcyA9IGF2YWlsYWJsZUltYWdlcztcbiAgICAgICAgdGhpcy5sb2FkVmVjdG9yRGF0YSA9IGxvYWRWZWN0b3JEYXRhIHx8IGxvYWRWZWN0b3JUaWxlO1xuICAgICAgICB0aGlzLmxvYWRpbmcgPSB7fTtcbiAgICAgICAgdGhpcy5sb2FkZWQgPSB7fTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBJbXBsZW1lbnRzIHtAbGluayBXb3JrZXJTb3VyY2UjbG9hZFRpbGV9LiBEZWxlZ2F0ZXMgdG9cbiAgICAgKiB7QGxpbmsgVmVjdG9yVGlsZVdvcmtlclNvdXJjZSNsb2FkVmVjdG9yRGF0YX0gKHdoaWNoIGJ5IGRlZmF1bHQgZXhwZWN0c1xuICAgICAqIGEgYHBhcmFtcy51cmxgIHByb3BlcnR5KSBmb3IgZmV0Y2hpbmcgYW5kIHByb2R1Y2luZyBhIFZlY3RvclRpbGUgb2JqZWN0LlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgbG9hZFRpbGUocGFyYW1zOiBXb3JrZXJUaWxlUGFyYW1ldGVycywgY2FsbGJhY2s6IFdvcmtlclRpbGVDYWxsYmFjaykge1xuICAgICAgICBjb25zdCB1aWQgPSBwYXJhbXMudWlkO1xuXG4gICAgICAgIGlmICghdGhpcy5sb2FkaW5nKVxuICAgICAgICAgICAgdGhpcy5sb2FkaW5nID0ge307XG5cbiAgICAgICAgY29uc3QgcGVyZiA9IChwYXJhbXMgJiYgcGFyYW1zLnJlcXVlc3QgJiYgcGFyYW1zLnJlcXVlc3QuY29sbGVjdFJlc291cmNlVGltaW5nKSA/XG4gICAgICAgICAgICBuZXcgUmVxdWVzdFBlcmZvcm1hbmNlKHBhcmFtcy5yZXF1ZXN0KSA6IGZhbHNlO1xuXG4gICAgICAgIGNvbnN0IHdvcmtlclRpbGUgPSB0aGlzLmxvYWRpbmdbdWlkXSA9IG5ldyBXb3JrZXJUaWxlKHBhcmFtcyk7XG4gICAgICAgIHdvcmtlclRpbGUuYWJvcnQgPSB0aGlzLmxvYWRWZWN0b3JEYXRhKHBhcmFtcywgKGVyciwgcmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmxvYWRpbmdbdWlkXTtcblxuICAgICAgICAgICAgaWYgKGVyciB8fCAhcmVzcG9uc2UpIHtcbiAgICAgICAgICAgICAgICB3b3JrZXJUaWxlLnN0YXR1cyA9ICdkb25lJztcbiAgICAgICAgICAgICAgICB0aGlzLmxvYWRlZFt1aWRdID0gd29ya2VyVGlsZTtcbiAgICAgICAgICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgcmF3VGlsZURhdGEgPSByZXNwb25zZS5yYXdEYXRhO1xuICAgICAgICAgICAgY29uc3QgY2FjaGVDb250cm9sID0ge307XG4gICAgICAgICAgICBpZiAocmVzcG9uc2UuZXhwaXJlcykgY2FjaGVDb250cm9sLmV4cGlyZXMgPSByZXNwb25zZS5leHBpcmVzO1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlLmNhY2hlQ29udHJvbCkgY2FjaGVDb250cm9sLmNhY2hlQ29udHJvbCA9IHJlc3BvbnNlLmNhY2hlQ29udHJvbDtcblxuICAgICAgICAgICAgY29uc3QgcmVzb3VyY2VUaW1pbmcgPSB7fTtcbiAgICAgICAgICAgIGlmIChwZXJmKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVzb3VyY2VUaW1pbmdEYXRhID0gcGVyZi5maW5pc2goKTtcbiAgICAgICAgICAgICAgICAvLyBpdCdzIG5lY2Vzc2FyeSB0byBldmFsIHRoZSByZXN1bHQgb2YgZ2V0RW50cmllc0J5TmFtZSgpIGhlcmUgdmlhIHBhcnNlL3N0cmluZ2lmeVxuICAgICAgICAgICAgICAgIC8vIGxhdGUgZXZhbHVhdGlvbiBpbiB0aGUgbWFpbiB0aHJlYWQgY2F1c2VzIFR5cGVFcnJvcjogaWxsZWdhbCBpbnZvY2F0aW9uXG4gICAgICAgICAgICAgICAgaWYgKHJlc291cmNlVGltaW5nRGF0YSlcbiAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VUaW1pbmcucmVzb3VyY2VUaW1pbmcgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHJlc291cmNlVGltaW5nRGF0YSkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB3b3JrZXJUaWxlLnZlY3RvclRpbGUgPSByZXNwb25zZS52ZWN0b3JUaWxlO1xuICAgICAgICAgICAgd29ya2VyVGlsZS5wYXJzZShyZXNwb25zZS52ZWN0b3JUaWxlLCB0aGlzLmxheWVySW5kZXgsIHRoaXMuYXZhaWxhYmxlSW1hZ2VzLCB0aGlzLmFjdG9yLCAoZXJyLCByZXN1bHQpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoZXJyIHx8ICFyZXN1bHQpIHJldHVybiBjYWxsYmFjayhlcnIpO1xuXG4gICAgICAgICAgICAgICAgLy8gVHJhbnNmZXJyaW5nIGEgY29weSBvZiByYXdUaWxlRGF0YSBiZWNhdXNlIHRoZSB3b3JrZXIgbmVlZHMgdG8gcmV0YWluIGl0cyBjb3B5LlxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGV4dGVuZCh7cmF3VGlsZURhdGE6IHJhd1RpbGVEYXRhLnNsaWNlKDApfSwgcmVzdWx0LCBjYWNoZUNvbnRyb2wsIHJlc291cmNlVGltaW5nKSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdGhpcy5sb2FkZWQgPSB0aGlzLmxvYWRlZCB8fCB7fTtcbiAgICAgICAgICAgIHRoaXMubG9hZGVkW3VpZF0gPSB3b3JrZXJUaWxlO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBJbXBsZW1lbnRzIHtAbGluayBXb3JrZXJTb3VyY2UjcmVsb2FkVGlsZX0uXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICByZWxvYWRUaWxlKHBhcmFtczogV29ya2VyVGlsZVBhcmFtZXRlcnMsIGNhbGxiYWNrOiBXb3JrZXJUaWxlQ2FsbGJhY2spIHtcbiAgICAgICAgY29uc3QgbG9hZGVkID0gdGhpcy5sb2FkZWQsXG4gICAgICAgICAgICB1aWQgPSBwYXJhbXMudWlkLFxuICAgICAgICAgICAgdnRTb3VyY2UgPSB0aGlzO1xuICAgICAgICBpZiAobG9hZGVkICYmIGxvYWRlZFt1aWRdKSB7XG4gICAgICAgICAgICBjb25zdCB3b3JrZXJUaWxlID0gbG9hZGVkW3VpZF07XG4gICAgICAgICAgICB3b3JrZXJUaWxlLnNob3dDb2xsaXNpb25Cb3hlcyA9IHBhcmFtcy5zaG93Q29sbGlzaW9uQm94ZXM7XG5cbiAgICAgICAgICAgIGNvbnN0IGRvbmUgPSAoZXJyLCBkYXRhKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVsb2FkQ2FsbGJhY2sgPSB3b3JrZXJUaWxlLnJlbG9hZENhbGxiYWNrO1xuICAgICAgICAgICAgICAgIGlmIChyZWxvYWRDYWxsYmFjaykge1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgd29ya2VyVGlsZS5yZWxvYWRDYWxsYmFjaztcbiAgICAgICAgICAgICAgICAgICAgd29ya2VyVGlsZS5wYXJzZSh3b3JrZXJUaWxlLnZlY3RvclRpbGUsIHZ0U291cmNlLmxheWVySW5kZXgsIHRoaXMuYXZhaWxhYmxlSW1hZ2VzLCB2dFNvdXJjZS5hY3RvciwgcmVsb2FkQ2FsbGJhY2spO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjYWxsYmFjayhlcnIsIGRhdGEpO1xuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgaWYgKHdvcmtlclRpbGUuc3RhdHVzID09PSAncGFyc2luZycpIHtcbiAgICAgICAgICAgICAgICB3b3JrZXJUaWxlLnJlbG9hZENhbGxiYWNrID0gZG9uZTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAod29ya2VyVGlsZS5zdGF0dXMgPT09ICdkb25lJykge1xuICAgICAgICAgICAgICAgIC8vIGlmIHRoZXJlIHdhcyBubyB2ZWN0b3IgdGlsZSBkYXRhIG9uIHRoZSBpbml0aWFsIGxvYWQsIGRvbid0IHRyeSBhbmQgcmUtcGFyc2UgdGlsZVxuICAgICAgICAgICAgICAgIGlmICh3b3JrZXJUaWxlLnZlY3RvclRpbGUpIHtcbiAgICAgICAgICAgICAgICAgICAgd29ya2VyVGlsZS5wYXJzZSh3b3JrZXJUaWxlLnZlY3RvclRpbGUsIHRoaXMubGF5ZXJJbmRleCwgdGhpcy5hdmFpbGFibGVJbWFnZXMsIHRoaXMuYWN0b3IsIGRvbmUpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBJbXBsZW1lbnRzIHtAbGluayBXb3JrZXJTb3VyY2UjYWJvcnRUaWxlfS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBwYXJhbXNcbiAgICAgKiBAcGFyYW0gcGFyYW1zLnVpZCBUaGUgVUlEIGZvciB0aGlzIHRpbGUuXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBhYm9ydFRpbGUocGFyYW1zOiBUaWxlUGFyYW1ldGVycywgY2FsbGJhY2s6IFdvcmtlclRpbGVDYWxsYmFjaykge1xuICAgICAgICBjb25zdCBsb2FkaW5nID0gdGhpcy5sb2FkaW5nLFxuICAgICAgICAgICAgdWlkID0gcGFyYW1zLnVpZDtcbiAgICAgICAgaWYgKGxvYWRpbmcgJiYgbG9hZGluZ1t1aWRdICYmIGxvYWRpbmdbdWlkXS5hYm9ydCkge1xuICAgICAgICAgICAgbG9hZGluZ1t1aWRdLmFib3J0KCk7XG4gICAgICAgICAgICBkZWxldGUgbG9hZGluZ1t1aWRdO1xuICAgICAgICB9XG4gICAgICAgIGNhbGxiYWNrKCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogSW1wbGVtZW50cyB7QGxpbmsgV29ya2VyU291cmNlI3JlbW92ZVRpbGV9LlxuICAgICAqXG4gICAgICogQHBhcmFtIHBhcmFtc1xuICAgICAqIEBwYXJhbSBwYXJhbXMudWlkIFRoZSBVSUQgZm9yIHRoaXMgdGlsZS5cbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHJlbW92ZVRpbGUocGFyYW1zOiBUaWxlUGFyYW1ldGVycywgY2FsbGJhY2s6IFdvcmtlclRpbGVDYWxsYmFjaykge1xuICAgICAgICBjb25zdCBsb2FkZWQgPSB0aGlzLmxvYWRlZCxcbiAgICAgICAgICAgIHVpZCA9IHBhcmFtcy51aWQ7XG4gICAgICAgIGlmIChsb2FkZWQgJiYgbG9hZGVkW3VpZF0pIHtcbiAgICAgICAgICAgIGRlbGV0ZSBsb2FkZWRbdWlkXTtcbiAgICAgICAgfVxuICAgICAgICBjYWxsYmFjaygpO1xuICAgIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgVmVjdG9yVGlsZVdvcmtlclNvdXJjZTtcbiIsIi8vIEBmbG93XG5cbmltcG9ydCBERU1EYXRhIGZyb20gJy4uL2RhdGEvZGVtX2RhdGEnO1xuaW1wb3J0IHtSR0JBSW1hZ2V9IGZyb20gJy4uL3V0aWwvaW1hZ2UnO1xuaW1wb3J0IHdpbmRvdyBmcm9tICcuLi91dGlsL3dpbmRvdyc7XG5cbmltcG9ydCB0eXBlIEFjdG9yIGZyb20gJy4uL3V0aWwvYWN0b3InO1xuaW1wb3J0IHR5cGUge1xuICAgIFdvcmtlckRFTVRpbGVQYXJhbWV0ZXJzLFxuICAgIFdvcmtlckRFTVRpbGVDYWxsYmFjayxcbiAgICBUaWxlUGFyYW1ldGVyc1xufSBmcm9tICcuL3dvcmtlcl9zb3VyY2UnO1xuY29uc3Qge0ltYWdlQml0bWFwfSA9IHdpbmRvdztcblxuY2xhc3MgUmFzdGVyREVNVGlsZVdvcmtlclNvdXJjZSB7XG4gICAgYWN0b3I6IEFjdG9yO1xuICAgIGxvYWRlZDoge1tfOiBzdHJpbmddOiBERU1EYXRhfTtcbiAgICBvZmZzY3JlZW5DYW52YXM6IE9mZnNjcmVlbkNhbnZhcztcbiAgICBvZmZzY3JlZW5DYW52YXNDb250ZXh0OiBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQ7XG5cbiAgICBjb25zdHJ1Y3RvcigpIHtcbiAgICAgICAgdGhpcy5sb2FkZWQgPSB7fTtcbiAgICB9XG5cbiAgICBsb2FkVGlsZShwYXJhbXM6IFdvcmtlckRFTVRpbGVQYXJhbWV0ZXJzLCBjYWxsYmFjazogV29ya2VyREVNVGlsZUNhbGxiYWNrKSB7XG4gICAgICAgIGNvbnN0IHt1aWQsIGVuY29kaW5nLCByYXdJbWFnZURhdGF9ID0gcGFyYW1zO1xuICAgICAgICAvLyBNYWluIHRocmVhZCB3aWxsIHRyYW5zZmVyIEltYWdlQml0bWFwIGlmIG9mZnNjcmVlbiBkZWNvZGUgd2l0aCBPZmZzY3JlZW5DYW52YXMgaXMgc3VwcG9ydGVkLCBlbHNlIGl0IHdpbGwgdHJhbnNmZXIgYW4gYWxyZWFkeSBkZWNvZGVkIGltYWdlLlxuICAgICAgICBjb25zdCBpbWFnZVBpeGVscyA9IChJbWFnZUJpdG1hcCAmJiByYXdJbWFnZURhdGEgaW5zdGFuY2VvZiBJbWFnZUJpdG1hcCkgPyB0aGlzLmdldEltYWdlRGF0YShyYXdJbWFnZURhdGEpIDogcmF3SW1hZ2VEYXRhO1xuICAgICAgICBjb25zdCBkZW0gPSBuZXcgREVNRGF0YSh1aWQsIGltYWdlUGl4ZWxzLCBlbmNvZGluZyk7XG4gICAgICAgIHRoaXMubG9hZGVkID0gdGhpcy5sb2FkZWQgfHwge307XG4gICAgICAgIHRoaXMubG9hZGVkW3VpZF0gPSBkZW07XG4gICAgICAgIGNhbGxiYWNrKG51bGwsIGRlbSk7XG4gICAgfVxuXG4gICAgZ2V0SW1hZ2VEYXRhKGltZ0JpdG1hcDogSW1hZ2VCaXRtYXApOiBSR0JBSW1hZ2Uge1xuICAgICAgICAvLyBMYXppbHkgaW5pdGlhbGl6ZSBPZmZzY3JlZW5DYW52YXNcbiAgICAgICAgaWYgKCF0aGlzLm9mZnNjcmVlbkNhbnZhcyB8fCAhdGhpcy5vZmZzY3JlZW5DYW52YXNDb250ZXh0KSB7XG4gICAgICAgICAgICAvLyBEZW0gdGlsZXMgYXJlIHR5cGljYWxseSAyNTZ4MjU2XG4gICAgICAgICAgICB0aGlzLm9mZnNjcmVlbkNhbnZhcyA9IG5ldyBPZmZzY3JlZW5DYW52YXMoaW1nQml0bWFwLndpZHRoLCBpbWdCaXRtYXAuaGVpZ2h0KTtcbiAgICAgICAgICAgIHRoaXMub2Zmc2NyZWVuQ2FudmFzQ29udGV4dCA9IHRoaXMub2Zmc2NyZWVuQ2FudmFzLmdldENvbnRleHQoJzJkJyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLm9mZnNjcmVlbkNhbnZhcy53aWR0aCA9IGltZ0JpdG1hcC53aWR0aDtcbiAgICAgICAgdGhpcy5vZmZzY3JlZW5DYW52YXMuaGVpZ2h0ID0gaW1nQml0bWFwLmhlaWdodDtcblxuICAgICAgICB0aGlzLm9mZnNjcmVlbkNhbnZhc0NvbnRleHQuZHJhd0ltYWdlKGltZ0JpdG1hcCwgMCwgMCwgaW1nQml0bWFwLndpZHRoLCBpbWdCaXRtYXAuaGVpZ2h0KTtcbiAgICAgICAgLy8gSW5zZXJ0IGFuIGFkZGl0aW9uYWwgMXB4IHBhZGRpbmcgYXJvdW5kIHRoZSBpbWFnZSB0byBhbGxvdyBiYWNrZmlsbGluZyBmb3IgbmVpZ2hib3JpbmcgZGF0YS5cbiAgICAgICAgY29uc3QgaW1nRGF0YSA9IHRoaXMub2Zmc2NyZWVuQ2FudmFzQ29udGV4dC5nZXRJbWFnZURhdGEoLTEsIC0xLCBpbWdCaXRtYXAud2lkdGggKyAyLCBpbWdCaXRtYXAuaGVpZ2h0ICsgMik7XG4gICAgICAgIHRoaXMub2Zmc2NyZWVuQ2FudmFzQ29udGV4dC5jbGVhclJlY3QoMCwgMCwgdGhpcy5vZmZzY3JlZW5DYW52YXMud2lkdGgsIHRoaXMub2Zmc2NyZWVuQ2FudmFzLmhlaWdodCk7XG4gICAgICAgIHJldHVybiBuZXcgUkdCQUltYWdlKHt3aWR0aDogaW1nRGF0YS53aWR0aCwgaGVpZ2h0OiBpbWdEYXRhLmhlaWdodH0sIGltZ0RhdGEuZGF0YSk7XG4gICAgfVxuXG4gICAgcmVtb3ZlVGlsZShwYXJhbXM6IFRpbGVQYXJhbWV0ZXJzKSB7XG4gICAgICAgIGNvbnN0IGxvYWRlZCA9IHRoaXMubG9hZGVkLFxuICAgICAgICAgICAgdWlkID0gcGFyYW1zLnVpZDtcbiAgICAgICAgaWYgKGxvYWRlZCAmJiBsb2FkZWRbdWlkXSkge1xuICAgICAgICAgICAgZGVsZXRlIGxvYWRlZFt1aWRdO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBSYXN0ZXJERU1UaWxlV29ya2VyU291cmNlO1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IHJld2luZDtcblxuZnVuY3Rpb24gcmV3aW5kKGdqLCBvdXRlcikge1xuICAgIHZhciB0eXBlID0gZ2ogJiYgZ2oudHlwZSwgaTtcblxuICAgIGlmICh0eXBlID09PSAnRmVhdHVyZUNvbGxlY3Rpb24nKSB7XG4gICAgICAgIGZvciAoaSA9IDA7IGkgPCBnai5mZWF0dXJlcy5sZW5ndGg7IGkrKykgcmV3aW5kKGdqLmZlYXR1cmVzW2ldLCBvdXRlcik7XG5cbiAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdHZW9tZXRyeUNvbGxlY3Rpb24nKSB7XG4gICAgICAgIGZvciAoaSA9IDA7IGkgPCBnai5nZW9tZXRyaWVzLmxlbmd0aDsgaSsrKSByZXdpbmQoZ2ouZ2VvbWV0cmllc1tpXSwgb3V0ZXIpO1xuXG4gICAgfSBlbHNlIGlmICh0eXBlID09PSAnRmVhdHVyZScpIHtcbiAgICAgICAgcmV3aW5kKGdqLmdlb21ldHJ5LCBvdXRlcik7XG5cbiAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdQb2x5Z29uJykge1xuICAgICAgICByZXdpbmRSaW5ncyhnai5jb29yZGluYXRlcywgb3V0ZXIpO1xuXG4gICAgfSBlbHNlIGlmICh0eXBlID09PSAnTXVsdGlQb2x5Z29uJykge1xuICAgICAgICBmb3IgKGkgPSAwOyBpIDwgZ2ouY29vcmRpbmF0ZXMubGVuZ3RoOyBpKyspIHJld2luZFJpbmdzKGdqLmNvb3JkaW5hdGVzW2ldLCBvdXRlcik7XG4gICAgfVxuXG4gICAgcmV0dXJuIGdqO1xufVxuXG5mdW5jdGlvbiByZXdpbmRSaW5ncyhyaW5ncywgb3V0ZXIpIHtcbiAgICBpZiAocmluZ3MubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICByZXdpbmRSaW5nKHJpbmdzWzBdLCBvdXRlcik7XG4gICAgZm9yICh2YXIgaSA9IDE7IGkgPCByaW5ncy5sZW5ndGg7IGkrKykge1xuICAgICAgICByZXdpbmRSaW5nKHJpbmdzW2ldLCAhb3V0ZXIpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcmV3aW5kUmluZyhyaW5nLCBkaXIpIHtcbiAgICB2YXIgYXJlYSA9IDAsIGVyciA9IDA7XG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IHJpbmcubGVuZ3RoLCBqID0gbGVuIC0gMTsgaSA8IGxlbjsgaiA9IGkrKykge1xuICAgICAgICB2YXIgayA9IChyaW5nW2ldWzBdIC0gcmluZ1tqXVswXSkgKiAocmluZ1tqXVsxXSArIHJpbmdbaV1bMV0pO1xuICAgICAgICB2YXIgbSA9IGFyZWEgKyBrO1xuICAgICAgICBlcnIgKz0gTWF0aC5hYnMoYXJlYSkgPj0gTWF0aC5hYnMoaykgPyBhcmVhIC0gbSArIGsgOiBrIC0gbSArIGFyZWE7XG4gICAgICAgIGFyZWEgPSBtO1xuICAgIH1cbiAgICBpZiAoYXJlYSArIGVyciA+PSAwICE9PSAhIWRpcikgcmluZy5yZXZlcnNlKCk7XG59XG4iLCIvLyBAZmxvd1xuXG5pbXBvcnQgUG9pbnQgZnJvbSAnQG1hcGJveC9wb2ludC1nZW9tZXRyeSc7XG5cbmltcG9ydCBtdnQgZnJvbSAnQG1hcGJveC92ZWN0b3ItdGlsZSc7XG5jb25zdCB0b0dlb0pTT04gPSBtdnQuVmVjdG9yVGlsZUZlYXR1cmUucHJvdG90eXBlLnRvR2VvSlNPTjtcbmltcG9ydCBFWFRFTlQgZnJvbSAnLi4vZGF0YS9leHRlbnQnO1xuXG4vLyBUaGUgZmVhdHVyZSB0eXBlIHVzZWQgYnkgZ2VvanNvbi12dCBhbmQgc3VwZXJjbHVzdGVyLiBTaG91bGQgYmUgZXh0cmFjdGVkIHRvXG4vLyBnbG9iYWwgdHlwZSBhbmQgdXNlZCBpbiBtb2R1bGUgZGVmaW5pdGlvbnMgZm9yIHRob3NlIHR3byBtb2R1bGVzLlxudHlwZSBGZWF0dXJlID0ge1xuICAgIHR5cGU6IDEsXG4gICAgaWQ6IG1peGVkLFxuICAgIHRhZ3M6IHtbXzogc3RyaW5nXTogc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbn0sXG4gICAgZ2VvbWV0cnk6IEFycmF5PFtudW1iZXIsIG51bWJlcl0+LFxufSB8IHtcbiAgICB0eXBlOiAyIHwgMyxcbiAgICBpZDogbWl4ZWQsXG4gICAgdGFnczoge1tfOiBzdHJpbmddOiBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFufSxcbiAgICBnZW9tZXRyeTogQXJyYXk8QXJyYXk8W251bWJlciwgbnVtYmVyXT4+LFxufVxuXG5jbGFzcyBGZWF0dXJlV3JhcHBlciBpbXBsZW1lbnRzIFZlY3RvclRpbGVGZWF0dXJlIHtcbiAgICBfZmVhdHVyZTogRmVhdHVyZTtcblxuICAgIGV4dGVudDogbnVtYmVyO1xuICAgIHR5cGU6IDEgfCAyIHwgMztcbiAgICBpZDogbnVtYmVyO1xuICAgIHByb3BlcnRpZXM6IHtbXzogc3RyaW5nXTogc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbn07XG5cbiAgICBjb25zdHJ1Y3RvcihmZWF0dXJlOiBGZWF0dXJlKSB7XG4gICAgICAgIHRoaXMuX2ZlYXR1cmUgPSBmZWF0dXJlO1xuXG4gICAgICAgIHRoaXMuZXh0ZW50ID0gRVhURU5UO1xuICAgICAgICB0aGlzLnR5cGUgPSBmZWF0dXJlLnR5cGU7XG4gICAgICAgIHRoaXMucHJvcGVydGllcyA9IGZlYXR1cmUudGFncztcblxuICAgICAgICAvLyBJZiB0aGUgZmVhdHVyZSBoYXMgYSB0b3AtbGV2ZWwgYGlkYCBwcm9wZXJ0eSwgY29weSBpdCBvdmVyLCBidXQgb25seVxuICAgICAgICAvLyBpZiBpdCBjYW4gYmUgY29lcmNlZCB0byBhbiBpbnRlZ2VyLCBiZWNhdXNlIHRoaXMgd3JhcHBlciBpcyB1c2VkIGZvclxuICAgICAgICAvLyBzZXJpYWxpemluZyBnZW9qc29uIGZlYXR1cmUgZGF0YSBpbnRvIHZlY3RvciB0aWxlIFBCRiBkYXRhLCBhbmQgdGhlXG4gICAgICAgIC8vIHZlY3RvciB0aWxlIHNwZWMgb25seSBzdXBwb3J0cyBpbnRlZ2VyIHZhbHVlcyBmb3IgZmVhdHVyZSBpZHMgLS1cbiAgICAgICAgLy8gYWxsb3dpbmcgbm9uLWludGVnZXIgdmFsdWVzIGhlcmUgcmVzdWx0cyBpbiBhIG5vbi1jb21wbGlhbnQgUEJGXG4gICAgICAgIC8vIHRoYXQgY2F1c2VzIGFuIGV4Y2VwdGlvbiB3aGVuIGl0IGlzIHBhcnNlZCB3aXRoIHZlY3Rvci10aWxlLWpzXG4gICAgICAgIGlmICgnaWQnIGluIGZlYXR1cmUgJiYgIWlzTmFOKGZlYXR1cmUuaWQpKSB7XG4gICAgICAgICAgICB0aGlzLmlkID0gcGFyc2VJbnQoZmVhdHVyZS5pZCwgMTApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgbG9hZEdlb21ldHJ5KCkge1xuICAgICAgICBpZiAodGhpcy5fZmVhdHVyZS50eXBlID09PSAxKSB7XG4gICAgICAgICAgICBjb25zdCBnZW9tZXRyeSA9IFtdO1xuICAgICAgICAgICAgZm9yIChjb25zdCBwb2ludCBvZiB0aGlzLl9mZWF0dXJlLmdlb21ldHJ5KSB7XG4gICAgICAgICAgICAgICAgZ2VvbWV0cnkucHVzaChbbmV3IFBvaW50KHBvaW50WzBdLCBwb2ludFsxXSldKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBnZW9tZXRyeTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IGdlb21ldHJ5ID0gW107XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJpbmcgb2YgdGhpcy5fZmVhdHVyZS5nZW9tZXRyeSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IG5ld1JpbmcgPSBbXTtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHBvaW50IG9mIHJpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgbmV3UmluZy5wdXNoKG5ldyBQb2ludChwb2ludFswXSwgcG9pbnRbMV0pKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZ2VvbWV0cnkucHVzaChuZXdSaW5nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBnZW9tZXRyeTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHRvR2VvSlNPTih4OiBudW1iZXIsIHk6IG51bWJlciwgejogbnVtYmVyKSB7XG4gICAgICAgIHJldHVybiB0b0dlb0pTT04uY2FsbCh0aGlzLCB4LCB5LCB6KTtcbiAgICB9XG59XG5cbmNsYXNzIEdlb0pTT05XcmFwcGVyIGltcGxlbWVudHMgVmVjdG9yVGlsZSwgVmVjdG9yVGlsZUxheWVyIHtcbiAgICBsYXllcnM6IHtbXzogc3RyaW5nXTogVmVjdG9yVGlsZUxheWVyfTtcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgZXh0ZW50OiBudW1iZXI7XG4gICAgbGVuZ3RoOiBudW1iZXI7XG4gICAgX2ZlYXR1cmVzOiBBcnJheTxGZWF0dXJlPjtcblxuICAgIGNvbnN0cnVjdG9yKGZlYXR1cmVzOiBBcnJheTxGZWF0dXJlPikge1xuICAgICAgICB0aGlzLmxheWVycyA9IHsnX2dlb2pzb25UaWxlTGF5ZXInOiB0aGlzfTtcbiAgICAgICAgdGhpcy5uYW1lID0gJ19nZW9qc29uVGlsZUxheWVyJztcbiAgICAgICAgdGhpcy5leHRlbnQgPSBFWFRFTlQ7XG4gICAgICAgIHRoaXMubGVuZ3RoID0gZmVhdHVyZXMubGVuZ3RoO1xuICAgICAgICB0aGlzLl9mZWF0dXJlcyA9IGZlYXR1cmVzO1xuICAgIH1cblxuICAgIGZlYXR1cmUoaTogbnVtYmVyKTogVmVjdG9yVGlsZUZlYXR1cmUge1xuICAgICAgICByZXR1cm4gbmV3IEZlYXR1cmVXcmFwcGVyKHRoaXMuX2ZlYXR1cmVzW2ldKTtcbiAgICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IEdlb0pTT05XcmFwcGVyO1xuIiwiJ3VzZSBzdHJpY3QnXG5cbnZhciBQb2ludCA9IHJlcXVpcmUoJ0BtYXBib3gvcG9pbnQtZ2VvbWV0cnknKVxudmFyIFZlY3RvclRpbGVGZWF0dXJlID0gcmVxdWlyZSgnQG1hcGJveC92ZWN0b3ItdGlsZScpLlZlY3RvclRpbGVGZWF0dXJlXG5cbm1vZHVsZS5leHBvcnRzID0gR2VvSlNPTldyYXBwZXJcblxuLy8gY29uZm9ybSB0byB2ZWN0b3J0aWxlIGFwaVxuZnVuY3Rpb24gR2VvSlNPTldyYXBwZXIgKGZlYXR1cmVzLCBvcHRpb25zKSB7XG4gIHRoaXMub3B0aW9ucyA9IG9wdGlvbnMgfHwge31cbiAgdGhpcy5mZWF0dXJlcyA9IGZlYXR1cmVzXG4gIHRoaXMubGVuZ3RoID0gZmVhdHVyZXMubGVuZ3RoXG59XG5cbkdlb0pTT05XcmFwcGVyLnByb3RvdHlwZS5mZWF0dXJlID0gZnVuY3Rpb24gKGkpIHtcbiAgcmV0dXJuIG5ldyBGZWF0dXJlV3JhcHBlcih0aGlzLmZlYXR1cmVzW2ldLCB0aGlzLm9wdGlvbnMuZXh0ZW50KVxufVxuXG5mdW5jdGlvbiBGZWF0dXJlV3JhcHBlciAoZmVhdHVyZSwgZXh0ZW50KSB7XG4gIHRoaXMuaWQgPSB0eXBlb2YgZmVhdHVyZS5pZCA9PT0gJ251bWJlcicgPyBmZWF0dXJlLmlkIDogdW5kZWZpbmVkXG4gIHRoaXMudHlwZSA9IGZlYXR1cmUudHlwZVxuICB0aGlzLnJhd0dlb21ldHJ5ID0gZmVhdHVyZS50eXBlID09PSAxID8gW2ZlYXR1cmUuZ2VvbWV0cnldIDogZmVhdHVyZS5nZW9tZXRyeVxuICB0aGlzLnByb3BlcnRpZXMgPSBmZWF0dXJlLnRhZ3NcbiAgdGhpcy5leHRlbnQgPSBleHRlbnQgfHwgNDA5NlxufVxuXG5GZWF0dXJlV3JhcHBlci5wcm90b3R5cGUubG9hZEdlb21ldHJ5ID0gZnVuY3Rpb24gKCkge1xuICB2YXIgcmluZ3MgPSB0aGlzLnJhd0dlb21ldHJ5XG4gIHRoaXMuZ2VvbWV0cnkgPSBbXVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgcmluZ3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcmluZyA9IHJpbmdzW2ldXG4gICAgdmFyIG5ld1JpbmcgPSBbXVxuICAgIGZvciAodmFyIGogPSAwOyBqIDwgcmluZy5sZW5ndGg7IGorKykge1xuICAgICAgbmV3UmluZy5wdXNoKG5ldyBQb2ludChyaW5nW2pdWzBdLCByaW5nW2pdWzFdKSlcbiAgICB9XG4gICAgdGhpcy5nZW9tZXRyeS5wdXNoKG5ld1JpbmcpXG4gIH1cbiAgcmV0dXJuIHRoaXMuZ2VvbWV0cnlcbn1cblxuRmVhdHVyZVdyYXBwZXIucHJvdG90eXBlLmJib3ggPSBmdW5jdGlvbiAoKSB7XG4gIGlmICghdGhpcy5nZW9tZXRyeSkgdGhpcy5sb2FkR2VvbWV0cnkoKVxuXG4gIHZhciByaW5ncyA9IHRoaXMuZ2VvbWV0cnlcbiAgdmFyIHgxID0gSW5maW5pdHlcbiAgdmFyIHgyID0gLUluZmluaXR5XG4gIHZhciB5MSA9IEluZmluaXR5XG4gIHZhciB5MiA9IC1JbmZpbml0eVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgcmluZ3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcmluZyA9IHJpbmdzW2ldXG5cbiAgICBmb3IgKHZhciBqID0gMDsgaiA8IHJpbmcubGVuZ3RoOyBqKyspIHtcbiAgICAgIHZhciBjb29yZCA9IHJpbmdbal1cblxuICAgICAgeDEgPSBNYXRoLm1pbih4MSwgY29vcmQueClcbiAgICAgIHgyID0gTWF0aC5tYXgoeDIsIGNvb3JkLngpXG4gICAgICB5MSA9IE1hdGgubWluKHkxLCBjb29yZC55KVxuICAgICAgeTIgPSBNYXRoLm1heCh5MiwgY29vcmQueSlcbiAgICB9XG4gIH1cblxuICByZXR1cm4gW3gxLCB5MSwgeDIsIHkyXVxufVxuXG5GZWF0dXJlV3JhcHBlci5wcm90b3R5cGUudG9HZW9KU09OID0gVmVjdG9yVGlsZUZlYXR1cmUucHJvdG90eXBlLnRvR2VvSlNPTlxuIiwidmFyIFBiZiA9IHJlcXVpcmUoJ3BiZicpXG52YXIgR2VvSlNPTldyYXBwZXIgPSByZXF1aXJlKCcuL2xpYi9nZW9qc29uX3dyYXBwZXInKVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZyb21WZWN0b3JUaWxlSnNcbm1vZHVsZS5leHBvcnRzLmZyb21WZWN0b3JUaWxlSnMgPSBmcm9tVmVjdG9yVGlsZUpzXG5tb2R1bGUuZXhwb3J0cy5mcm9tR2VvanNvblZ0ID0gZnJvbUdlb2pzb25WdFxubW9kdWxlLmV4cG9ydHMuR2VvSlNPTldyYXBwZXIgPSBHZW9KU09OV3JhcHBlclxuXG4vKipcbiAqIFNlcmlhbGl6ZSBhIHZlY3Rvci10aWxlLWpzLWNyZWF0ZWQgdGlsZSB0byBwYmZcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gdGlsZVxuICogQHJldHVybiB7QnVmZmVyfSB1bmNvbXByZXNzZWQsIHBiZi1zZXJpYWxpemVkIHRpbGUgZGF0YVxuICovXG5mdW5jdGlvbiBmcm9tVmVjdG9yVGlsZUpzICh0aWxlKSB7XG4gIHZhciBvdXQgPSBuZXcgUGJmKClcbiAgd3JpdGVUaWxlKHRpbGUsIG91dClcbiAgcmV0dXJuIG91dC5maW5pc2goKVxufVxuXG4vKipcbiAqIFNlcmlhbGl6ZWQgYSBnZW9qc29uLXZ0LWNyZWF0ZWQgdGlsZSB0byBwYmYuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IGxheWVycyAtIEFuIG9iamVjdCBtYXBwaW5nIGxheWVyIG5hbWVzIHRvIGdlb2pzb24tdnQtY3JlYXRlZCB2ZWN0b3IgdGlsZSBvYmplY3RzXG4gKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnNdIC0gQW4gb2JqZWN0IHNwZWNpZnlpbmcgdGhlIHZlY3Rvci10aWxlIHNwZWNpZmljYXRpb24gdmVyc2lvbiBhbmQgZXh0ZW50IHRoYXQgd2VyZSB1c2VkIHRvIGNyZWF0ZSBgbGF5ZXJzYC5cbiAqIEBwYXJhbSB7TnVtYmVyfSBbb3B0aW9ucy52ZXJzaW9uPTFdIC0gVmVyc2lvbiBvZiB2ZWN0b3ItdGlsZSBzcGVjIHVzZWRcbiAqIEBwYXJhbSB7TnVtYmVyfSBbb3B0aW9ucy5leHRlbnQ9NDA5Nl0gLSBFeHRlbnQgb2YgdGhlIHZlY3RvciB0aWxlXG4gKiBAcmV0dXJuIHtCdWZmZXJ9IHVuY29tcHJlc3NlZCwgcGJmLXNlcmlhbGl6ZWQgdGlsZSBkYXRhXG4gKi9cbmZ1bmN0aW9uIGZyb21HZW9qc29uVnQgKGxheWVycywgb3B0aW9ucykge1xuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fVxuICB2YXIgbCA9IHt9XG4gIGZvciAodmFyIGsgaW4gbGF5ZXJzKSB7XG4gICAgbFtrXSA9IG5ldyBHZW9KU09OV3JhcHBlcihsYXllcnNba10uZmVhdHVyZXMsIG9wdGlvbnMpXG4gICAgbFtrXS5uYW1lID0ga1xuICAgIGxba10udmVyc2lvbiA9IG9wdGlvbnMudmVyc2lvblxuICAgIGxba10uZXh0ZW50ID0gb3B0aW9ucy5leHRlbnRcbiAgfVxuICByZXR1cm4gZnJvbVZlY3RvclRpbGVKcyh7IGxheWVyczogbCB9KVxufVxuXG5mdW5jdGlvbiB3cml0ZVRpbGUgKHRpbGUsIHBiZikge1xuICBmb3IgKHZhciBrZXkgaW4gdGlsZS5sYXllcnMpIHtcbiAgICBwYmYud3JpdGVNZXNzYWdlKDMsIHdyaXRlTGF5ZXIsIHRpbGUubGF5ZXJzW2tleV0pXG4gIH1cbn1cblxuZnVuY3Rpb24gd3JpdGVMYXllciAobGF5ZXIsIHBiZikge1xuICBwYmYud3JpdGVWYXJpbnRGaWVsZCgxNSwgbGF5ZXIudmVyc2lvbiB8fCAxKVxuICBwYmYud3JpdGVTdHJpbmdGaWVsZCgxLCBsYXllci5uYW1lIHx8ICcnKVxuICBwYmYud3JpdGVWYXJpbnRGaWVsZCg1LCBsYXllci5leHRlbnQgfHwgNDA5NilcblxuICB2YXIgaVxuICB2YXIgY29udGV4dCA9IHtcbiAgICBrZXlzOiBbXSxcbiAgICB2YWx1ZXM6IFtdLFxuICAgIGtleWNhY2hlOiB7fSxcbiAgICB2YWx1ZWNhY2hlOiB7fVxuICB9XG5cbiAgZm9yIChpID0gMDsgaSA8IGxheWVyLmxlbmd0aDsgaSsrKSB7XG4gICAgY29udGV4dC5mZWF0dXJlID0gbGF5ZXIuZmVhdHVyZShpKVxuICAgIHBiZi53cml0ZU1lc3NhZ2UoMiwgd3JpdGVGZWF0dXJlLCBjb250ZXh0KVxuICB9XG5cbiAgdmFyIGtleXMgPSBjb250ZXh0LmtleXNcbiAgZm9yIChpID0gMDsgaSA8IGtleXMubGVuZ3RoOyBpKyspIHtcbiAgICBwYmYud3JpdGVTdHJpbmdGaWVsZCgzLCBrZXlzW2ldKVxuICB9XG5cbiAgdmFyIHZhbHVlcyA9IGNvbnRleHQudmFsdWVzXG4gIGZvciAoaSA9IDA7IGkgPCB2YWx1ZXMubGVuZ3RoOyBpKyspIHtcbiAgICBwYmYud3JpdGVNZXNzYWdlKDQsIHdyaXRlVmFsdWUsIHZhbHVlc1tpXSlcbiAgfVxufVxuXG5mdW5jdGlvbiB3cml0ZUZlYXR1cmUgKGNvbnRleHQsIHBiZikge1xuICB2YXIgZmVhdHVyZSA9IGNvbnRleHQuZmVhdHVyZVxuXG4gIGlmIChmZWF0dXJlLmlkICE9PSB1bmRlZmluZWQpIHtcbiAgICBwYmYud3JpdGVWYXJpbnRGaWVsZCgxLCBmZWF0dXJlLmlkKVxuICB9XG5cbiAgcGJmLndyaXRlTWVzc2FnZSgyLCB3cml0ZVByb3BlcnRpZXMsIGNvbnRleHQpXG4gIHBiZi53cml0ZVZhcmludEZpZWxkKDMsIGZlYXR1cmUudHlwZSlcbiAgcGJmLndyaXRlTWVzc2FnZSg0LCB3cml0ZUdlb21ldHJ5LCBmZWF0dXJlKVxufVxuXG5mdW5jdGlvbiB3cml0ZVByb3BlcnRpZXMgKGNvbnRleHQsIHBiZikge1xuICB2YXIgZmVhdHVyZSA9IGNvbnRleHQuZmVhdHVyZVxuICB2YXIga2V5cyA9IGNvbnRleHQua2V5c1xuICB2YXIgdmFsdWVzID0gY29udGV4dC52YWx1ZXNcbiAgdmFyIGtleWNhY2hlID0gY29udGV4dC5rZXljYWNoZVxuICB2YXIgdmFsdWVjYWNoZSA9IGNvbnRleHQudmFsdWVjYWNoZVxuXG4gIGZvciAodmFyIGtleSBpbiBmZWF0dXJlLnByb3BlcnRpZXMpIHtcbiAgICB2YXIgdmFsdWUgPSBmZWF0dXJlLnByb3BlcnRpZXNba2V5XVxuXG4gICAgdmFyIGtleUluZGV4ID0ga2V5Y2FjaGVba2V5XVxuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCkgY29udGludWUgLy8gZG9uJ3QgZW5jb2RlIG51bGwgdmFsdWUgcHJvcGVydGllc1xuXG4gICAgaWYgKHR5cGVvZiBrZXlJbmRleCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGtleXMucHVzaChrZXkpXG4gICAgICBrZXlJbmRleCA9IGtleXMubGVuZ3RoIC0gMVxuICAgICAga2V5Y2FjaGVba2V5XSA9IGtleUluZGV4XG4gICAgfVxuICAgIHBiZi53cml0ZVZhcmludChrZXlJbmRleClcblxuICAgIHZhciB0eXBlID0gdHlwZW9mIHZhbHVlXG4gICAgaWYgKHR5cGUgIT09ICdzdHJpbmcnICYmIHR5cGUgIT09ICdib29sZWFuJyAmJiB0eXBlICE9PSAnbnVtYmVyJykge1xuICAgICAgdmFsdWUgPSBKU09OLnN0cmluZ2lmeSh2YWx1ZSlcbiAgICB9XG4gICAgdmFyIHZhbHVlS2V5ID0gdHlwZSArICc6JyArIHZhbHVlXG4gICAgdmFyIHZhbHVlSW5kZXggPSB2YWx1ZWNhY2hlW3ZhbHVlS2V5XVxuICAgIGlmICh0eXBlb2YgdmFsdWVJbmRleCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHZhbHVlcy5wdXNoKHZhbHVlKVxuICAgICAgdmFsdWVJbmRleCA9IHZhbHVlcy5sZW5ndGggLSAxXG4gICAgICB2YWx1ZWNhY2hlW3ZhbHVlS2V5XSA9IHZhbHVlSW5kZXhcbiAgICB9XG4gICAgcGJmLndyaXRlVmFyaW50KHZhbHVlSW5kZXgpXG4gIH1cbn1cblxuZnVuY3Rpb24gY29tbWFuZCAoY21kLCBsZW5ndGgpIHtcbiAgcmV0dXJuIChsZW5ndGggPDwgMykgKyAoY21kICYgMHg3KVxufVxuXG5mdW5jdGlvbiB6aWd6YWcgKG51bSkge1xuICByZXR1cm4gKG51bSA8PCAxKSBeIChudW0gPj4gMzEpXG59XG5cbmZ1bmN0aW9uIHdyaXRlR2VvbWV0cnkgKGZlYXR1cmUsIHBiZikge1xuICB2YXIgZ2VvbWV0cnkgPSBmZWF0dXJlLmxvYWRHZW9tZXRyeSgpXG4gIHZhciB0eXBlID0gZmVhdHVyZS50eXBlXG4gIHZhciB4ID0gMFxuICB2YXIgeSA9IDBcbiAgdmFyIHJpbmdzID0gZ2VvbWV0cnkubGVuZ3RoXG4gIGZvciAodmFyIHIgPSAwOyByIDwgcmluZ3M7IHIrKykge1xuICAgIHZhciByaW5nID0gZ2VvbWV0cnlbcl1cbiAgICB2YXIgY291bnQgPSAxXG4gICAgaWYgKHR5cGUgPT09IDEpIHtcbiAgICAgIGNvdW50ID0gcmluZy5sZW5ndGhcbiAgICB9XG4gICAgcGJmLndyaXRlVmFyaW50KGNvbW1hbmQoMSwgY291bnQpKSAvLyBtb3ZldG9cbiAgICAvLyBkbyBub3Qgd3JpdGUgcG9seWdvbiBjbG9zaW5nIHBhdGggYXMgbGluZXRvXG4gICAgdmFyIGxpbmVDb3VudCA9IHR5cGUgPT09IDMgPyByaW5nLmxlbmd0aCAtIDEgOiByaW5nLmxlbmd0aFxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGluZUNvdW50OyBpKyspIHtcbiAgICAgIGlmIChpID09PSAxICYmIHR5cGUgIT09IDEpIHtcbiAgICAgICAgcGJmLndyaXRlVmFyaW50KGNvbW1hbmQoMiwgbGluZUNvdW50IC0gMSkpIC8vIGxpbmV0b1xuICAgICAgfVxuICAgICAgdmFyIGR4ID0gcmluZ1tpXS54IC0geFxuICAgICAgdmFyIGR5ID0gcmluZ1tpXS55IC0geVxuICAgICAgcGJmLndyaXRlVmFyaW50KHppZ3phZyhkeCkpXG4gICAgICBwYmYud3JpdGVWYXJpbnQoemlnemFnKGR5KSlcbiAgICAgIHggKz0gZHhcbiAgICAgIHkgKz0gZHlcbiAgICB9XG4gICAgaWYgKHR5cGUgPT09IDMpIHtcbiAgICAgIHBiZi53cml0ZVZhcmludChjb21tYW5kKDcsIDEpKSAvLyBjbG9zZXBhdGhcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gd3JpdGVWYWx1ZSAodmFsdWUsIHBiZikge1xuICB2YXIgdHlwZSA9IHR5cGVvZiB2YWx1ZVxuICBpZiAodHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICBwYmYud3JpdGVTdHJpbmdGaWVsZCgxLCB2YWx1ZSlcbiAgfSBlbHNlIGlmICh0eXBlID09PSAnYm9vbGVhbicpIHtcbiAgICBwYmYud3JpdGVCb29sZWFuRmllbGQoNywgdmFsdWUpXG4gIH0gZWxzZSBpZiAodHlwZSA9PT0gJ251bWJlcicpIHtcbiAgICBpZiAodmFsdWUgJSAxICE9PSAwKSB7XG4gICAgICBwYmYud3JpdGVEb3VibGVGaWVsZCgzLCB2YWx1ZSlcbiAgICB9IGVsc2UgaWYgKHZhbHVlIDwgMCkge1xuICAgICAgcGJmLndyaXRlU1ZhcmludEZpZWxkKDYsIHZhbHVlKVxuICAgIH0gZWxzZSB7XG4gICAgICBwYmYud3JpdGVWYXJpbnRGaWVsZCg1LCB2YWx1ZSlcbiAgICB9XG4gIH1cbn1cbiIsIlxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gc29ydEtEKGlkcywgY29vcmRzLCBub2RlU2l6ZSwgbGVmdCwgcmlnaHQsIGRlcHRoKSB7XG4gICAgaWYgKHJpZ2h0IC0gbGVmdCA8PSBub2RlU2l6ZSkgcmV0dXJuO1xuXG4gICAgY29uc3QgbSA9IChsZWZ0ICsgcmlnaHQpID4+IDE7XG5cbiAgICBzZWxlY3QoaWRzLCBjb29yZHMsIG0sIGxlZnQsIHJpZ2h0LCBkZXB0aCAlIDIpO1xuXG4gICAgc29ydEtEKGlkcywgY29vcmRzLCBub2RlU2l6ZSwgbGVmdCwgbSAtIDEsIGRlcHRoICsgMSk7XG4gICAgc29ydEtEKGlkcywgY29vcmRzLCBub2RlU2l6ZSwgbSArIDEsIHJpZ2h0LCBkZXB0aCArIDEpO1xufVxuXG5mdW5jdGlvbiBzZWxlY3QoaWRzLCBjb29yZHMsIGssIGxlZnQsIHJpZ2h0LCBpbmMpIHtcblxuICAgIHdoaWxlIChyaWdodCA+IGxlZnQpIHtcbiAgICAgICAgaWYgKHJpZ2h0IC0gbGVmdCA+IDYwMCkge1xuICAgICAgICAgICAgY29uc3QgbiA9IHJpZ2h0IC0gbGVmdCArIDE7XG4gICAgICAgICAgICBjb25zdCBtID0gayAtIGxlZnQgKyAxO1xuICAgICAgICAgICAgY29uc3QgeiA9IE1hdGgubG9nKG4pO1xuICAgICAgICAgICAgY29uc3QgcyA9IDAuNSAqIE1hdGguZXhwKDIgKiB6IC8gMyk7XG4gICAgICAgICAgICBjb25zdCBzZCA9IDAuNSAqIE1hdGguc3FydCh6ICogcyAqIChuIC0gcykgLyBuKSAqIChtIC0gbiAvIDIgPCAwID8gLTEgOiAxKTtcbiAgICAgICAgICAgIGNvbnN0IG5ld0xlZnQgPSBNYXRoLm1heChsZWZ0LCBNYXRoLmZsb29yKGsgLSBtICogcyAvIG4gKyBzZCkpO1xuICAgICAgICAgICAgY29uc3QgbmV3UmlnaHQgPSBNYXRoLm1pbihyaWdodCwgTWF0aC5mbG9vcihrICsgKG4gLSBtKSAqIHMgLyBuICsgc2QpKTtcbiAgICAgICAgICAgIHNlbGVjdChpZHMsIGNvb3JkcywgaywgbmV3TGVmdCwgbmV3UmlnaHQsIGluYyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0ID0gY29vcmRzWzIgKiBrICsgaW5jXTtcbiAgICAgICAgbGV0IGkgPSBsZWZ0O1xuICAgICAgICBsZXQgaiA9IHJpZ2h0O1xuXG4gICAgICAgIHN3YXBJdGVtKGlkcywgY29vcmRzLCBsZWZ0LCBrKTtcbiAgICAgICAgaWYgKGNvb3Jkc1syICogcmlnaHQgKyBpbmNdID4gdCkgc3dhcEl0ZW0oaWRzLCBjb29yZHMsIGxlZnQsIHJpZ2h0KTtcblxuICAgICAgICB3aGlsZSAoaSA8IGopIHtcbiAgICAgICAgICAgIHN3YXBJdGVtKGlkcywgY29vcmRzLCBpLCBqKTtcbiAgICAgICAgICAgIGkrKztcbiAgICAgICAgICAgIGotLTtcbiAgICAgICAgICAgIHdoaWxlIChjb29yZHNbMiAqIGkgKyBpbmNdIDwgdCkgaSsrO1xuICAgICAgICAgICAgd2hpbGUgKGNvb3Jkc1syICogaiArIGluY10gPiB0KSBqLS07XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29vcmRzWzIgKiBsZWZ0ICsgaW5jXSA9PT0gdCkgc3dhcEl0ZW0oaWRzLCBjb29yZHMsIGxlZnQsIGopO1xuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGorKztcbiAgICAgICAgICAgIHN3YXBJdGVtKGlkcywgY29vcmRzLCBqLCByaWdodCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaiA8PSBrKSBsZWZ0ID0gaiArIDE7XG4gICAgICAgIGlmIChrIDw9IGopIHJpZ2h0ID0gaiAtIDE7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzd2FwSXRlbShpZHMsIGNvb3JkcywgaSwgaikge1xuICAgIHN3YXAoaWRzLCBpLCBqKTtcbiAgICBzd2FwKGNvb3JkcywgMiAqIGksIDIgKiBqKTtcbiAgICBzd2FwKGNvb3JkcywgMiAqIGkgKyAxLCAyICogaiArIDEpO1xufVxuXG5mdW5jdGlvbiBzd2FwKGFyciwgaSwgaikge1xuICAgIGNvbnN0IHRtcCA9IGFycltpXTtcbiAgICBhcnJbaV0gPSBhcnJbal07XG4gICAgYXJyW2pdID0gdG1wO1xufVxuIiwiXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiByYW5nZShpZHMsIGNvb3JkcywgbWluWCwgbWluWSwgbWF4WCwgbWF4WSwgbm9kZVNpemUpIHtcbiAgICBjb25zdCBzdGFjayA9IFswLCBpZHMubGVuZ3RoIC0gMSwgMF07XG4gICAgY29uc3QgcmVzdWx0ID0gW107XG4gICAgbGV0IHgsIHk7XG5cbiAgICB3aGlsZSAoc3RhY2subGVuZ3RoKSB7XG4gICAgICAgIGNvbnN0IGF4aXMgPSBzdGFjay5wb3AoKTtcbiAgICAgICAgY29uc3QgcmlnaHQgPSBzdGFjay5wb3AoKTtcbiAgICAgICAgY29uc3QgbGVmdCA9IHN0YWNrLnBvcCgpO1xuXG4gICAgICAgIGlmIChyaWdodCAtIGxlZnQgPD0gbm9kZVNpemUpIHtcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSBsZWZ0OyBpIDw9IHJpZ2h0OyBpKyspIHtcbiAgICAgICAgICAgICAgICB4ID0gY29vcmRzWzIgKiBpXTtcbiAgICAgICAgICAgICAgICB5ID0gY29vcmRzWzIgKiBpICsgMV07XG4gICAgICAgICAgICAgICAgaWYgKHggPj0gbWluWCAmJiB4IDw9IG1heFggJiYgeSA+PSBtaW5ZICYmIHkgPD0gbWF4WSkgcmVzdWx0LnB1c2goaWRzW2ldKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbSA9IE1hdGguZmxvb3IoKGxlZnQgKyByaWdodCkgLyAyKTtcblxuICAgICAgICB4ID0gY29vcmRzWzIgKiBtXTtcbiAgICAgICAgeSA9IGNvb3Jkc1syICogbSArIDFdO1xuXG4gICAgICAgIGlmICh4ID49IG1pblggJiYgeCA8PSBtYXhYICYmIHkgPj0gbWluWSAmJiB5IDw9IG1heFkpIHJlc3VsdC5wdXNoKGlkc1ttXSk7XG5cbiAgICAgICAgY29uc3QgbmV4dEF4aXMgPSAoYXhpcyArIDEpICUgMjtcblxuICAgICAgICBpZiAoYXhpcyA9PT0gMCA/IG1pblggPD0geCA6IG1pblkgPD0geSkge1xuICAgICAgICAgICAgc3RhY2sucHVzaChsZWZ0KTtcbiAgICAgICAgICAgIHN0YWNrLnB1c2gobSAtIDEpO1xuICAgICAgICAgICAgc3RhY2sucHVzaChuZXh0QXhpcyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGF4aXMgPT09IDAgPyBtYXhYID49IHggOiBtYXhZID49IHkpIHtcbiAgICAgICAgICAgIHN0YWNrLnB1c2gobSArIDEpO1xuICAgICAgICAgICAgc3RhY2sucHVzaChyaWdodCk7XG4gICAgICAgICAgICBzdGFjay5wdXNoKG5leHRBeGlzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG4iLCJcbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHdpdGhpbihpZHMsIGNvb3JkcywgcXgsIHF5LCByLCBub2RlU2l6ZSkge1xuICAgIGNvbnN0IHN0YWNrID0gWzAsIGlkcy5sZW5ndGggLSAxLCAwXTtcbiAgICBjb25zdCByZXN1bHQgPSBbXTtcbiAgICBjb25zdCByMiA9IHIgKiByO1xuXG4gICAgd2hpbGUgKHN0YWNrLmxlbmd0aCkge1xuICAgICAgICBjb25zdCBheGlzID0gc3RhY2sucG9wKCk7XG4gICAgICAgIGNvbnN0IHJpZ2h0ID0gc3RhY2sucG9wKCk7XG4gICAgICAgIGNvbnN0IGxlZnQgPSBzdGFjay5wb3AoKTtcblxuICAgICAgICBpZiAocmlnaHQgLSBsZWZ0IDw9IG5vZGVTaXplKSB7XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gbGVmdDsgaSA8PSByaWdodDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgaWYgKHNxRGlzdChjb29yZHNbMiAqIGldLCBjb29yZHNbMiAqIGkgKyAxXSwgcXgsIHF5KSA8PSByMikgcmVzdWx0LnB1c2goaWRzW2ldKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbSA9IE1hdGguZmxvb3IoKGxlZnQgKyByaWdodCkgLyAyKTtcblxuICAgICAgICBjb25zdCB4ID0gY29vcmRzWzIgKiBtXTtcbiAgICAgICAgY29uc3QgeSA9IGNvb3Jkc1syICogbSArIDFdO1xuXG4gICAgICAgIGlmIChzcURpc3QoeCwgeSwgcXgsIHF5KSA8PSByMikgcmVzdWx0LnB1c2goaWRzW21dKTtcblxuICAgICAgICBjb25zdCBuZXh0QXhpcyA9IChheGlzICsgMSkgJSAyO1xuXG4gICAgICAgIGlmIChheGlzID09PSAwID8gcXggLSByIDw9IHggOiBxeSAtIHIgPD0geSkge1xuICAgICAgICAgICAgc3RhY2sucHVzaChsZWZ0KTtcbiAgICAgICAgICAgIHN0YWNrLnB1c2gobSAtIDEpO1xuICAgICAgICAgICAgc3RhY2sucHVzaChuZXh0QXhpcyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGF4aXMgPT09IDAgPyBxeCArIHIgPj0geCA6IHF5ICsgciA+PSB5KSB7XG4gICAgICAgICAgICBzdGFjay5wdXNoKG0gKyAxKTtcbiAgICAgICAgICAgIHN0YWNrLnB1c2gocmlnaHQpO1xuICAgICAgICAgICAgc3RhY2sucHVzaChuZXh0QXhpcyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBzcURpc3QoYXgsIGF5LCBieCwgYnkpIHtcbiAgICBjb25zdCBkeCA9IGF4IC0gYng7XG4gICAgY29uc3QgZHkgPSBheSAtIGJ5O1xuICAgIHJldHVybiBkeCAqIGR4ICsgZHkgKiBkeTtcbn1cbiIsIlxuaW1wb3J0IHNvcnQgZnJvbSAnLi9zb3J0JztcbmltcG9ydCByYW5nZSBmcm9tICcuL3JhbmdlJztcbmltcG9ydCB3aXRoaW4gZnJvbSAnLi93aXRoaW4nO1xuXG5jb25zdCBkZWZhdWx0R2V0WCA9IHAgPT4gcFswXTtcbmNvbnN0IGRlZmF1bHRHZXRZID0gcCA9PiBwWzFdO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBLREJ1c2gge1xuICAgIGNvbnN0cnVjdG9yKHBvaW50cywgZ2V0WCA9IGRlZmF1bHRHZXRYLCBnZXRZID0gZGVmYXVsdEdldFksIG5vZGVTaXplID0gNjQsIEFycmF5VHlwZSA9IEZsb2F0NjRBcnJheSkge1xuICAgICAgICB0aGlzLm5vZGVTaXplID0gbm9kZVNpemU7XG4gICAgICAgIHRoaXMucG9pbnRzID0gcG9pbnRzO1xuXG4gICAgICAgIGNvbnN0IEluZGV4QXJyYXlUeXBlID0gcG9pbnRzLmxlbmd0aCA8IDY1NTM2ID8gVWludDE2QXJyYXkgOiBVaW50MzJBcnJheTtcblxuICAgICAgICBjb25zdCBpZHMgPSB0aGlzLmlkcyA9IG5ldyBJbmRleEFycmF5VHlwZShwb2ludHMubGVuZ3RoKTtcbiAgICAgICAgY29uc3QgY29vcmRzID0gdGhpcy5jb29yZHMgPSBuZXcgQXJyYXlUeXBlKHBvaW50cy5sZW5ndGggKiAyKTtcblxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBvaW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWRzW2ldID0gaTtcbiAgICAgICAgICAgIGNvb3Jkc1syICogaV0gPSBnZXRYKHBvaW50c1tpXSk7XG4gICAgICAgICAgICBjb29yZHNbMiAqIGkgKyAxXSA9IGdldFkocG9pbnRzW2ldKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNvcnQoaWRzLCBjb29yZHMsIG5vZGVTaXplLCAwLCBpZHMubGVuZ3RoIC0gMSwgMCk7XG4gICAgfVxuXG4gICAgcmFuZ2UobWluWCwgbWluWSwgbWF4WCwgbWF4WSkge1xuICAgICAgICByZXR1cm4gcmFuZ2UodGhpcy5pZHMsIHRoaXMuY29vcmRzLCBtaW5YLCBtaW5ZLCBtYXhYLCBtYXhZLCB0aGlzLm5vZGVTaXplKTtcbiAgICB9XG5cbiAgICB3aXRoaW4oeCwgeSwgcikge1xuICAgICAgICByZXR1cm4gd2l0aGluKHRoaXMuaWRzLCB0aGlzLmNvb3JkcywgeCwgeSwgciwgdGhpcy5ub2RlU2l6ZSk7XG4gICAgfVxufVxuIiwiXG5pbXBvcnQgS0RCdXNoIGZyb20gJ2tkYnVzaCc7XG5cbmNvbnN0IGRlZmF1bHRPcHRpb25zID0ge1xuICAgIG1pblpvb206IDAsICAgLy8gbWluIHpvb20gdG8gZ2VuZXJhdGUgY2x1c3RlcnMgb25cbiAgICBtYXhab29tOiAxNiwgIC8vIG1heCB6b29tIGxldmVsIHRvIGNsdXN0ZXIgdGhlIHBvaW50cyBvblxuICAgIG1pblBvaW50czogMiwgLy8gbWluaW11bSBwb2ludHMgdG8gZm9ybSBhIGNsdXN0ZXJcbiAgICByYWRpdXM6IDQwLCAgIC8vIGNsdXN0ZXIgcmFkaXVzIGluIHBpeGVsc1xuICAgIGV4dGVudDogNTEyLCAgLy8gdGlsZSBleHRlbnQgKHJhZGl1cyBpcyBjYWxjdWxhdGVkIHJlbGF0aXZlIHRvIGl0KVxuICAgIG5vZGVTaXplOiA2NCwgLy8gc2l6ZSBvZiB0aGUgS0QtdHJlZSBsZWFmIG5vZGUsIGFmZmVjdHMgcGVyZm9ybWFuY2VcbiAgICBsb2c6IGZhbHNlLCAgIC8vIHdoZXRoZXIgdG8gbG9nIHRpbWluZyBpbmZvXG5cbiAgICAvLyB3aGV0aGVyIHRvIGdlbmVyYXRlIG51bWVyaWMgaWRzIGZvciBpbnB1dCBmZWF0dXJlcyAoaW4gdmVjdG9yIHRpbGVzKVxuICAgIGdlbmVyYXRlSWQ6IGZhbHNlLFxuXG4gICAgLy8gYSByZWR1Y2UgZnVuY3Rpb24gZm9yIGNhbGN1bGF0aW5nIGN1c3RvbSBjbHVzdGVyIHByb3BlcnRpZXNcbiAgICByZWR1Y2U6IG51bGwsIC8vIChhY2N1bXVsYXRlZCwgcHJvcHMpID0+IHsgYWNjdW11bGF0ZWQuc3VtICs9IHByb3BzLnN1bTsgfVxuXG4gICAgLy8gcHJvcGVydGllcyB0byB1c2UgZm9yIGluZGl2aWR1YWwgcG9pbnRzIHdoZW4gcnVubmluZyB0aGUgcmVkdWNlclxuICAgIG1hcDogcHJvcHMgPT4gcHJvcHMgLy8gcHJvcHMgPT4gKHtzdW06IHByb3BzLm15X3ZhbHVlfSlcbn07XG5cbmNvbnN0IGZyb3VuZCA9IE1hdGguZnJvdW5kIHx8ICh0bXAgPT4gKCh4KSA9PiB7IHRtcFswXSA9ICt4OyByZXR1cm4gdG1wWzBdOyB9KSkobmV3IEZsb2F0MzJBcnJheSgxKSk7XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN1cGVyY2x1c3RlciB7XG4gICAgY29uc3RydWN0b3Iob3B0aW9ucykge1xuICAgICAgICB0aGlzLm9wdGlvbnMgPSBleHRlbmQoT2JqZWN0LmNyZWF0ZShkZWZhdWx0T3B0aW9ucyksIG9wdGlvbnMpO1xuICAgICAgICB0aGlzLnRyZWVzID0gbmV3IEFycmF5KHRoaXMub3B0aW9ucy5tYXhab29tICsgMSk7XG4gICAgfVxuXG4gICAgbG9hZChwb2ludHMpIHtcbiAgICAgICAgY29uc3Qge2xvZywgbWluWm9vbSwgbWF4Wm9vbSwgbm9kZVNpemV9ID0gdGhpcy5vcHRpb25zO1xuXG4gICAgICAgIGlmIChsb2cpIGNvbnNvbGUudGltZSgndG90YWwgdGltZScpO1xuXG4gICAgICAgIGNvbnN0IHRpbWVySWQgPSBgcHJlcGFyZSAkeyAgcG9pbnRzLmxlbmd0aCAgfSBwb2ludHNgO1xuICAgICAgICBpZiAobG9nKSBjb25zb2xlLnRpbWUodGltZXJJZCk7XG5cbiAgICAgICAgdGhpcy5wb2ludHMgPSBwb2ludHM7XG5cbiAgICAgICAgLy8gZ2VuZXJhdGUgYSBjbHVzdGVyIG9iamVjdCBmb3IgZWFjaCBwb2ludCBhbmQgaW5kZXggaW5wdXQgcG9pbnRzIGludG8gYSBLRC10cmVlXG4gICAgICAgIGxldCBjbHVzdGVycyA9IFtdO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBvaW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKCFwb2ludHNbaV0uZ2VvbWV0cnkpIGNvbnRpbnVlO1xuICAgICAgICAgICAgY2x1c3RlcnMucHVzaChjcmVhdGVQb2ludENsdXN0ZXIocG9pbnRzW2ldLCBpKSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy50cmVlc1ttYXhab29tICsgMV0gPSBuZXcgS0RCdXNoKGNsdXN0ZXJzLCBnZXRYLCBnZXRZLCBub2RlU2l6ZSwgRmxvYXQzMkFycmF5KTtcblxuICAgICAgICBpZiAobG9nKSBjb25zb2xlLnRpbWVFbmQodGltZXJJZCk7XG5cbiAgICAgICAgLy8gY2x1c3RlciBwb2ludHMgb24gbWF4IHpvb20sIHRoZW4gY2x1c3RlciB0aGUgcmVzdWx0cyBvbiBwcmV2aW91cyB6b29tLCBldGMuO1xuICAgICAgICAvLyByZXN1bHRzIGluIGEgY2x1c3RlciBoaWVyYXJjaHkgYWNyb3NzIHpvb20gbGV2ZWxzXG4gICAgICAgIGZvciAobGV0IHogPSBtYXhab29tOyB6ID49IG1pblpvb207IHotLSkge1xuICAgICAgICAgICAgY29uc3Qgbm93ID0gK0RhdGUubm93KCk7XG5cbiAgICAgICAgICAgIC8vIGNyZWF0ZSBhIG5ldyBzZXQgb2YgY2x1c3RlcnMgZm9yIHRoZSB6b29tIGFuZCBpbmRleCB0aGVtIHdpdGggYSBLRC10cmVlXG4gICAgICAgICAgICBjbHVzdGVycyA9IHRoaXMuX2NsdXN0ZXIoY2x1c3RlcnMsIHopO1xuICAgICAgICAgICAgdGhpcy50cmVlc1t6XSA9IG5ldyBLREJ1c2goY2x1c3RlcnMsIGdldFgsIGdldFksIG5vZGVTaXplLCBGbG9hdDMyQXJyYXkpO1xuXG4gICAgICAgICAgICBpZiAobG9nKSBjb25zb2xlLmxvZygneiVkOiAlZCBjbHVzdGVycyBpbiAlZG1zJywgeiwgY2x1c3RlcnMubGVuZ3RoLCArRGF0ZS5ub3coKSAtIG5vdyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAobG9nKSBjb25zb2xlLnRpbWVFbmQoJ3RvdGFsIHRpbWUnKTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBnZXRDbHVzdGVycyhiYm94LCB6b29tKSB7XG4gICAgICAgIGxldCBtaW5MbmcgPSAoKGJib3hbMF0gKyAxODApICUgMzYwICsgMzYwKSAlIDM2MCAtIDE4MDtcbiAgICAgICAgY29uc3QgbWluTGF0ID0gTWF0aC5tYXgoLTkwLCBNYXRoLm1pbig5MCwgYmJveFsxXSkpO1xuICAgICAgICBsZXQgbWF4TG5nID0gYmJveFsyXSA9PT0gMTgwID8gMTgwIDogKChiYm94WzJdICsgMTgwKSAlIDM2MCArIDM2MCkgJSAzNjAgLSAxODA7XG4gICAgICAgIGNvbnN0IG1heExhdCA9IE1hdGgubWF4KC05MCwgTWF0aC5taW4oOTAsIGJib3hbM10pKTtcblxuICAgICAgICBpZiAoYmJveFsyXSAtIGJib3hbMF0gPj0gMzYwKSB7XG4gICAgICAgICAgICBtaW5MbmcgPSAtMTgwO1xuICAgICAgICAgICAgbWF4TG5nID0gMTgwO1xuICAgICAgICB9IGVsc2UgaWYgKG1pbkxuZyA+IG1heExuZykge1xuICAgICAgICAgICAgY29uc3QgZWFzdGVybkhlbSA9IHRoaXMuZ2V0Q2x1c3RlcnMoW21pbkxuZywgbWluTGF0LCAxODAsIG1heExhdF0sIHpvb20pO1xuICAgICAgICAgICAgY29uc3Qgd2VzdGVybkhlbSA9IHRoaXMuZ2V0Q2x1c3RlcnMoWy0xODAsIG1pbkxhdCwgbWF4TG5nLCBtYXhMYXRdLCB6b29tKTtcbiAgICAgICAgICAgIHJldHVybiBlYXN0ZXJuSGVtLmNvbmNhdCh3ZXN0ZXJuSGVtKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRyZWUgPSB0aGlzLnRyZWVzW3RoaXMuX2xpbWl0Wm9vbSh6b29tKV07XG4gICAgICAgIGNvbnN0IGlkcyA9IHRyZWUucmFuZ2UobG5nWChtaW5MbmcpLCBsYXRZKG1heExhdCksIGxuZ1gobWF4TG5nKSwgbGF0WShtaW5MYXQpKTtcbiAgICAgICAgY29uc3QgY2x1c3RlcnMgPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBpZCBvZiBpZHMpIHtcbiAgICAgICAgICAgIGNvbnN0IGMgPSB0cmVlLnBvaW50c1tpZF07XG4gICAgICAgICAgICBjbHVzdGVycy5wdXNoKGMubnVtUG9pbnRzID8gZ2V0Q2x1c3RlckpTT04oYykgOiB0aGlzLnBvaW50c1tjLmluZGV4XSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGNsdXN0ZXJzO1xuICAgIH1cblxuICAgIGdldENoaWxkcmVuKGNsdXN0ZXJJZCkge1xuICAgICAgICBjb25zdCBvcmlnaW5JZCA9IHRoaXMuX2dldE9yaWdpbklkKGNsdXN0ZXJJZCk7XG4gICAgICAgIGNvbnN0IG9yaWdpblpvb20gPSB0aGlzLl9nZXRPcmlnaW5ab29tKGNsdXN0ZXJJZCk7XG4gICAgICAgIGNvbnN0IGVycm9yTXNnID0gJ05vIGNsdXN0ZXIgd2l0aCB0aGUgc3BlY2lmaWVkIGlkLic7XG5cbiAgICAgICAgY29uc3QgaW5kZXggPSB0aGlzLnRyZWVzW29yaWdpblpvb21dO1xuICAgICAgICBpZiAoIWluZGV4KSB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNc2cpO1xuXG4gICAgICAgIGNvbnN0IG9yaWdpbiA9IGluZGV4LnBvaW50c1tvcmlnaW5JZF07XG4gICAgICAgIGlmICghb3JpZ2luKSB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNc2cpO1xuXG4gICAgICAgIGNvbnN0IHIgPSB0aGlzLm9wdGlvbnMucmFkaXVzIC8gKHRoaXMub3B0aW9ucy5leHRlbnQgKiBNYXRoLnBvdygyLCBvcmlnaW5ab29tIC0gMSkpO1xuICAgICAgICBjb25zdCBpZHMgPSBpbmRleC53aXRoaW4ob3JpZ2luLngsIG9yaWdpbi55LCByKTtcbiAgICAgICAgY29uc3QgY2hpbGRyZW4gPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBpZCBvZiBpZHMpIHtcbiAgICAgICAgICAgIGNvbnN0IGMgPSBpbmRleC5wb2ludHNbaWRdO1xuICAgICAgICAgICAgaWYgKGMucGFyZW50SWQgPT09IGNsdXN0ZXJJZCkge1xuICAgICAgICAgICAgICAgIGNoaWxkcmVuLnB1c2goYy5udW1Qb2ludHMgPyBnZXRDbHVzdGVySlNPTihjKSA6IHRoaXMucG9pbnRzW2MuaW5kZXhdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjaGlsZHJlbi5sZW5ndGggPT09IDApIHRocm93IG5ldyBFcnJvcihlcnJvck1zZyk7XG5cbiAgICAgICAgcmV0dXJuIGNoaWxkcmVuO1xuICAgIH1cblxuICAgIGdldExlYXZlcyhjbHVzdGVySWQsIGxpbWl0LCBvZmZzZXQpIHtcbiAgICAgICAgbGltaXQgPSBsaW1pdCB8fCAxMDtcbiAgICAgICAgb2Zmc2V0ID0gb2Zmc2V0IHx8IDA7XG5cbiAgICAgICAgY29uc3QgbGVhdmVzID0gW107XG4gICAgICAgIHRoaXMuX2FwcGVuZExlYXZlcyhsZWF2ZXMsIGNsdXN0ZXJJZCwgbGltaXQsIG9mZnNldCwgMCk7XG5cbiAgICAgICAgcmV0dXJuIGxlYXZlcztcbiAgICB9XG5cbiAgICBnZXRUaWxlKHosIHgsIHkpIHtcbiAgICAgICAgY29uc3QgdHJlZSA9IHRoaXMudHJlZXNbdGhpcy5fbGltaXRab29tKHopXTtcbiAgICAgICAgY29uc3QgejIgPSBNYXRoLnBvdygyLCB6KTtcbiAgICAgICAgY29uc3Qge2V4dGVudCwgcmFkaXVzfSA9IHRoaXMub3B0aW9ucztcbiAgICAgICAgY29uc3QgcCA9IHJhZGl1cyAvIGV4dGVudDtcbiAgICAgICAgY29uc3QgdG9wID0gKHkgLSBwKSAvIHoyO1xuICAgICAgICBjb25zdCBib3R0b20gPSAoeSArIDEgKyBwKSAvIHoyO1xuXG4gICAgICAgIGNvbnN0IHRpbGUgPSB7XG4gICAgICAgICAgICBmZWF0dXJlczogW11cbiAgICAgICAgfTtcblxuICAgICAgICB0aGlzLl9hZGRUaWxlRmVhdHVyZXMoXG4gICAgICAgICAgICB0cmVlLnJhbmdlKCh4IC0gcCkgLyB6MiwgdG9wLCAoeCArIDEgKyBwKSAvIHoyLCBib3R0b20pLFxuICAgICAgICAgICAgdHJlZS5wb2ludHMsIHgsIHksIHoyLCB0aWxlKTtcblxuICAgICAgICBpZiAoeCA9PT0gMCkge1xuICAgICAgICAgICAgdGhpcy5fYWRkVGlsZUZlYXR1cmVzKFxuICAgICAgICAgICAgICAgIHRyZWUucmFuZ2UoMSAtIHAgLyB6MiwgdG9wLCAxLCBib3R0b20pLFxuICAgICAgICAgICAgICAgIHRyZWUucG9pbnRzLCB6MiwgeSwgejIsIHRpbGUpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh4ID09PSB6MiAtIDEpIHtcbiAgICAgICAgICAgIHRoaXMuX2FkZFRpbGVGZWF0dXJlcyhcbiAgICAgICAgICAgICAgICB0cmVlLnJhbmdlKDAsIHRvcCwgcCAvIHoyLCBib3R0b20pLFxuICAgICAgICAgICAgICAgIHRyZWUucG9pbnRzLCAtMSwgeSwgejIsIHRpbGUpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRpbGUuZmVhdHVyZXMubGVuZ3RoID8gdGlsZSA6IG51bGw7XG4gICAgfVxuXG4gICAgZ2V0Q2x1c3RlckV4cGFuc2lvblpvb20oY2x1c3RlcklkKSB7XG4gICAgICAgIGxldCBleHBhbnNpb25ab29tID0gdGhpcy5fZ2V0T3JpZ2luWm9vbShjbHVzdGVySWQpIC0gMTtcbiAgICAgICAgd2hpbGUgKGV4cGFuc2lvblpvb20gPD0gdGhpcy5vcHRpb25zLm1heFpvb20pIHtcbiAgICAgICAgICAgIGNvbnN0IGNoaWxkcmVuID0gdGhpcy5nZXRDaGlsZHJlbihjbHVzdGVySWQpO1xuICAgICAgICAgICAgZXhwYW5zaW9uWm9vbSsrO1xuICAgICAgICAgICAgaWYgKGNoaWxkcmVuLmxlbmd0aCAhPT0gMSkgYnJlYWs7XG4gICAgICAgICAgICBjbHVzdGVySWQgPSBjaGlsZHJlblswXS5wcm9wZXJ0aWVzLmNsdXN0ZXJfaWQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGV4cGFuc2lvblpvb207XG4gICAgfVxuXG4gICAgX2FwcGVuZExlYXZlcyhyZXN1bHQsIGNsdXN0ZXJJZCwgbGltaXQsIG9mZnNldCwgc2tpcHBlZCkge1xuICAgICAgICBjb25zdCBjaGlsZHJlbiA9IHRoaXMuZ2V0Q2hpbGRyZW4oY2x1c3RlcklkKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGNoaWxkcmVuKSB7XG4gICAgICAgICAgICBjb25zdCBwcm9wcyA9IGNoaWxkLnByb3BlcnRpZXM7XG5cbiAgICAgICAgICAgIGlmIChwcm9wcyAmJiBwcm9wcy5jbHVzdGVyKSB7XG4gICAgICAgICAgICAgICAgaWYgKHNraXBwZWQgKyBwcm9wcy5wb2ludF9jb3VudCA8PSBvZmZzZXQpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gc2tpcCB0aGUgd2hvbGUgY2x1c3RlclxuICAgICAgICAgICAgICAgICAgICBza2lwcGVkICs9IHByb3BzLnBvaW50X2NvdW50O1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIGVudGVyIHRoZSBjbHVzdGVyXG4gICAgICAgICAgICAgICAgICAgIHNraXBwZWQgPSB0aGlzLl9hcHBlbmRMZWF2ZXMocmVzdWx0LCBwcm9wcy5jbHVzdGVyX2lkLCBsaW1pdCwgb2Zmc2V0LCBza2lwcGVkKTtcbiAgICAgICAgICAgICAgICAgICAgLy8gZXhpdCB0aGUgY2x1c3RlclxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc2tpcHBlZCA8IG9mZnNldCkge1xuICAgICAgICAgICAgICAgIC8vIHNraXAgYSBzaW5nbGUgcG9pbnRcbiAgICAgICAgICAgICAgICBza2lwcGVkKys7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIGFkZCBhIHNpbmdsZSBwb2ludFxuICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKGNoaWxkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXN1bHQubGVuZ3RoID09PSBsaW1pdCkgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gc2tpcHBlZDtcbiAgICB9XG5cbiAgICBfYWRkVGlsZUZlYXR1cmVzKGlkcywgcG9pbnRzLCB4LCB5LCB6MiwgdGlsZSkge1xuICAgICAgICBmb3IgKGNvbnN0IGkgb2YgaWRzKSB7XG4gICAgICAgICAgICBjb25zdCBjID0gcG9pbnRzW2ldO1xuICAgICAgICAgICAgY29uc3QgaXNDbHVzdGVyID0gYy5udW1Qb2ludHM7XG5cbiAgICAgICAgICAgIGxldCB0YWdzLCBweCwgcHk7XG4gICAgICAgICAgICBpZiAoaXNDbHVzdGVyKSB7XG4gICAgICAgICAgICAgICAgdGFncyA9IGdldENsdXN0ZXJQcm9wZXJ0aWVzKGMpO1xuICAgICAgICAgICAgICAgIHB4ID0gYy54O1xuICAgICAgICAgICAgICAgIHB5ID0gYy55O1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zdCBwID0gdGhpcy5wb2ludHNbYy5pbmRleF07XG4gICAgICAgICAgICAgICAgdGFncyA9IHAucHJvcGVydGllcztcbiAgICAgICAgICAgICAgICBweCA9IGxuZ1gocC5nZW9tZXRyeS5jb29yZGluYXRlc1swXSk7XG4gICAgICAgICAgICAgICAgcHkgPSBsYXRZKHAuZ2VvbWV0cnkuY29vcmRpbmF0ZXNbMV0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBmID0ge1xuICAgICAgICAgICAgICAgIHR5cGU6IDEsXG4gICAgICAgICAgICAgICAgZ2VvbWV0cnk6IFtbXG4gICAgICAgICAgICAgICAgICAgIE1hdGgucm91bmQodGhpcy5vcHRpb25zLmV4dGVudCAqIChweCAqIHoyIC0geCkpLFxuICAgICAgICAgICAgICAgICAgICBNYXRoLnJvdW5kKHRoaXMub3B0aW9ucy5leHRlbnQgKiAocHkgKiB6MiAtIHkpKVxuICAgICAgICAgICAgICAgIF1dLFxuICAgICAgICAgICAgICAgIHRhZ3NcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIC8vIGFzc2lnbiBpZFxuICAgICAgICAgICAgbGV0IGlkO1xuICAgICAgICAgICAgaWYgKGlzQ2x1c3Rlcikge1xuICAgICAgICAgICAgICAgIGlkID0gYy5pZDtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodGhpcy5vcHRpb25zLmdlbmVyYXRlSWQpIHtcbiAgICAgICAgICAgICAgICAvLyBvcHRpb25hbGx5IGdlbmVyYXRlIGlkXG4gICAgICAgICAgICAgICAgaWQgPSBjLmluZGV4O1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0aGlzLnBvaW50c1tjLmluZGV4XS5pZCkge1xuICAgICAgICAgICAgICAgIC8vIGtlZXAgaWQgaWYgYWxyZWFkeSBhc3NpZ25lZFxuICAgICAgICAgICAgICAgIGlkID0gdGhpcy5wb2ludHNbYy5pbmRleF0uaWQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChpZCAhPT0gdW5kZWZpbmVkKSBmLmlkID0gaWQ7XG5cbiAgICAgICAgICAgIHRpbGUuZmVhdHVyZXMucHVzaChmKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIF9saW1pdFpvb20oeikge1xuICAgICAgICByZXR1cm4gTWF0aC5tYXgodGhpcy5vcHRpb25zLm1pblpvb20sIE1hdGgubWluKE1hdGguZmxvb3IoK3opLCB0aGlzLm9wdGlvbnMubWF4Wm9vbSArIDEpKTtcbiAgICB9XG5cbiAgICBfY2x1c3Rlcihwb2ludHMsIHpvb20pIHtcbiAgICAgICAgY29uc3QgY2x1c3RlcnMgPSBbXTtcbiAgICAgICAgY29uc3Qge3JhZGl1cywgZXh0ZW50LCByZWR1Y2UsIG1pblBvaW50c30gPSB0aGlzLm9wdGlvbnM7XG4gICAgICAgIGNvbnN0IHIgPSByYWRpdXMgLyAoZXh0ZW50ICogTWF0aC5wb3coMiwgem9vbSkpO1xuXG4gICAgICAgIC8vIGxvb3AgdGhyb3VnaCBlYWNoIHBvaW50XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcG9pbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBjb25zdCBwID0gcG9pbnRzW2ldO1xuICAgICAgICAgICAgLy8gaWYgd2UndmUgYWxyZWFkeSB2aXNpdGVkIHRoZSBwb2ludCBhdCB0aGlzIHpvb20gbGV2ZWwsIHNraXAgaXRcbiAgICAgICAgICAgIGlmIChwLnpvb20gPD0gem9vbSkgY29udGludWU7XG4gICAgICAgICAgICBwLnpvb20gPSB6b29tO1xuXG4gICAgICAgICAgICAvLyBmaW5kIGFsbCBuZWFyYnkgcG9pbnRzXG4gICAgICAgICAgICBjb25zdCB0cmVlID0gdGhpcy50cmVlc1t6b29tICsgMV07XG4gICAgICAgICAgICBjb25zdCBuZWlnaGJvcklkcyA9IHRyZWUud2l0aGluKHAueCwgcC55LCByKTtcblxuICAgICAgICAgICAgY29uc3QgbnVtUG9pbnRzT3JpZ2luID0gcC5udW1Qb2ludHMgfHwgMTtcbiAgICAgICAgICAgIGxldCBudW1Qb2ludHMgPSBudW1Qb2ludHNPcmlnaW47XG5cbiAgICAgICAgICAgIC8vIGNvdW50IHRoZSBudW1iZXIgb2YgcG9pbnRzIGluIGEgcG90ZW50aWFsIGNsdXN0ZXJcbiAgICAgICAgICAgIGZvciAoY29uc3QgbmVpZ2hib3JJZCBvZiBuZWlnaGJvcklkcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGIgPSB0cmVlLnBvaW50c1tuZWlnaGJvcklkXTtcbiAgICAgICAgICAgICAgICAvLyBmaWx0ZXIgb3V0IG5laWdoYm9ycyB0aGF0IGFyZSBhbHJlYWR5IHByb2Nlc3NlZFxuICAgICAgICAgICAgICAgIGlmIChiLnpvb20gPiB6b29tKSBudW1Qb2ludHMgKz0gYi5udW1Qb2ludHMgfHwgMTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gaWYgdGhlcmUgd2VyZSBuZWlnaGJvcnMgdG8gbWVyZ2UsIGFuZCB0aGVyZSBhcmUgZW5vdWdoIHBvaW50cyB0byBmb3JtIGEgY2x1c3RlclxuICAgICAgICAgICAgaWYgKG51bVBvaW50cyA+IG51bVBvaW50c09yaWdpbiAmJiBudW1Qb2ludHMgPj0gbWluUG9pbnRzKSB7XG4gICAgICAgICAgICAgICAgbGV0IHd4ID0gcC54ICogbnVtUG9pbnRzT3JpZ2luO1xuICAgICAgICAgICAgICAgIGxldCB3eSA9IHAueSAqIG51bVBvaW50c09yaWdpbjtcblxuICAgICAgICAgICAgICAgIGxldCBjbHVzdGVyUHJvcGVydGllcyA9IHJlZHVjZSAmJiBudW1Qb2ludHNPcmlnaW4gPiAxID8gdGhpcy5fbWFwKHAsIHRydWUpIDogbnVsbDtcblxuICAgICAgICAgICAgICAgIC8vIGVuY29kZSBib3RoIHpvb20gYW5kIHBvaW50IGluZGV4IG9uIHdoaWNoIHRoZSBjbHVzdGVyIG9yaWdpbmF0ZWQgLS0gb2Zmc2V0IGJ5IHRvdGFsIGxlbmd0aCBvZiBmZWF0dXJlc1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkID0gKGkgPDwgNSkgKyAoem9vbSArIDEpICsgdGhpcy5wb2ludHMubGVuZ3RoO1xuXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBuZWlnaGJvcklkIG9mIG5laWdoYm9ySWRzKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGIgPSB0cmVlLnBvaW50c1tuZWlnaGJvcklkXTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoYi56b29tIDw9IHpvb20pIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICBiLnpvb20gPSB6b29tOyAvLyBzYXZlIHRoZSB6b29tIChzbyBpdCBkb2Vzbid0IGdldCBwcm9jZXNzZWQgdHdpY2UpXG5cbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbnVtUG9pbnRzMiA9IGIubnVtUG9pbnRzIHx8IDE7XG4gICAgICAgICAgICAgICAgICAgIHd4ICs9IGIueCAqIG51bVBvaW50czI7IC8vIGFjY3VtdWxhdGUgY29vcmRpbmF0ZXMgZm9yIGNhbGN1bGF0aW5nIHdlaWdodGVkIGNlbnRlclxuICAgICAgICAgICAgICAgICAgICB3eSArPSBiLnkgKiBudW1Qb2ludHMyO1xuXG4gICAgICAgICAgICAgICAgICAgIGIucGFyZW50SWQgPSBpZDtcblxuICAgICAgICAgICAgICAgICAgICBpZiAocmVkdWNlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWNsdXN0ZXJQcm9wZXJ0aWVzKSBjbHVzdGVyUHJvcGVydGllcyA9IHRoaXMuX21hcChwLCB0cnVlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZHVjZShjbHVzdGVyUHJvcGVydGllcywgdGhpcy5fbWFwKGIpKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHAucGFyZW50SWQgPSBpZDtcbiAgICAgICAgICAgICAgICBjbHVzdGVycy5wdXNoKGNyZWF0ZUNsdXN0ZXIod3ggLyBudW1Qb2ludHMsIHd5IC8gbnVtUG9pbnRzLCBpZCwgbnVtUG9pbnRzLCBjbHVzdGVyUHJvcGVydGllcykpO1xuXG4gICAgICAgICAgICB9IGVsc2UgeyAvLyBsZWZ0IHBvaW50cyBhcyB1bmNsdXN0ZXJlZFxuICAgICAgICAgICAgICAgIGNsdXN0ZXJzLnB1c2gocCk7XG5cbiAgICAgICAgICAgICAgICBpZiAobnVtUG9pbnRzID4gMSkge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IG5laWdoYm9ySWQgb2YgbmVpZ2hib3JJZHMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGIgPSB0cmVlLnBvaW50c1tuZWlnaGJvcklkXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChiLnpvb20gPD0gem9vbSkgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgICAgICBiLnpvb20gPSB6b29tO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2x1c3RlcnMucHVzaChiKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjbHVzdGVycztcbiAgICB9XG5cbiAgICAvLyBnZXQgaW5kZXggb2YgdGhlIHBvaW50IGZyb20gd2hpY2ggdGhlIGNsdXN0ZXIgb3JpZ2luYXRlZFxuICAgIF9nZXRPcmlnaW5JZChjbHVzdGVySWQpIHtcbiAgICAgICAgcmV0dXJuIChjbHVzdGVySWQgLSB0aGlzLnBvaW50cy5sZW5ndGgpID4+IDU7XG4gICAgfVxuXG4gICAgLy8gZ2V0IHpvb20gb2YgdGhlIHBvaW50IGZyb20gd2hpY2ggdGhlIGNsdXN0ZXIgb3JpZ2luYXRlZFxuICAgIF9nZXRPcmlnaW5ab29tKGNsdXN0ZXJJZCkge1xuICAgICAgICByZXR1cm4gKGNsdXN0ZXJJZCAtIHRoaXMucG9pbnRzLmxlbmd0aCkgJSAzMjtcbiAgICB9XG5cbiAgICBfbWFwKHBvaW50LCBjbG9uZSkge1xuICAgICAgICBpZiAocG9pbnQubnVtUG9pbnRzKSB7XG4gICAgICAgICAgICByZXR1cm4gY2xvbmUgPyBleHRlbmQoe30sIHBvaW50LnByb3BlcnRpZXMpIDogcG9pbnQucHJvcGVydGllcztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvcmlnaW5hbCA9IHRoaXMucG9pbnRzW3BvaW50LmluZGV4XS5wcm9wZXJ0aWVzO1xuICAgICAgICBjb25zdCByZXN1bHQgPSB0aGlzLm9wdGlvbnMubWFwKG9yaWdpbmFsKTtcbiAgICAgICAgcmV0dXJuIGNsb25lICYmIHJlc3VsdCA9PT0gb3JpZ2luYWwgPyBleHRlbmQoe30sIHJlc3VsdCkgOiByZXN1bHQ7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBjcmVhdGVDbHVzdGVyKHgsIHksIGlkLCBudW1Qb2ludHMsIHByb3BlcnRpZXMpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB4OiBmcm91bmQoeCksIC8vIHdlaWdodGVkIGNsdXN0ZXIgY2VudGVyOyByb3VuZCBmb3IgY29uc2lzdGVuY3kgd2l0aCBGbG9hdDMyQXJyYXkgaW5kZXhcbiAgICAgICAgeTogZnJvdW5kKHkpLFxuICAgICAgICB6b29tOiBJbmZpbml0eSwgLy8gdGhlIGxhc3Qgem9vbSB0aGUgY2x1c3RlciB3YXMgcHJvY2Vzc2VkIGF0XG4gICAgICAgIGlkLCAvLyBlbmNvZGVzIGluZGV4IG9mIHRoZSBmaXJzdCBjaGlsZCBvZiB0aGUgY2x1c3RlciBhbmQgaXRzIHpvb20gbGV2ZWxcbiAgICAgICAgcGFyZW50SWQ6IC0xLCAvLyBwYXJlbnQgY2x1c3RlciBpZFxuICAgICAgICBudW1Qb2ludHMsXG4gICAgICAgIHByb3BlcnRpZXNcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVQb2ludENsdXN0ZXIocCwgaWQpIHtcbiAgICBjb25zdCBbeCwgeV0gPSBwLmdlb21ldHJ5LmNvb3JkaW5hdGVzO1xuICAgIHJldHVybiB7XG4gICAgICAgIHg6IGZyb3VuZChsbmdYKHgpKSwgLy8gcHJvamVjdGVkIHBvaW50IGNvb3JkaW5hdGVzXG4gICAgICAgIHk6IGZyb3VuZChsYXRZKHkpKSxcbiAgICAgICAgem9vbTogSW5maW5pdHksIC8vIHRoZSBsYXN0IHpvb20gdGhlIHBvaW50IHdhcyBwcm9jZXNzZWQgYXRcbiAgICAgICAgaW5kZXg6IGlkLCAvLyBpbmRleCBvZiB0aGUgc291cmNlIGZlYXR1cmUgaW4gdGhlIG9yaWdpbmFsIGlucHV0IGFycmF5LFxuICAgICAgICBwYXJlbnRJZDogLTEgLy8gcGFyZW50IGNsdXN0ZXIgaWRcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBnZXRDbHVzdGVySlNPTihjbHVzdGVyKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogJ0ZlYXR1cmUnLFxuICAgICAgICBpZDogY2x1c3Rlci5pZCxcbiAgICAgICAgcHJvcGVydGllczogZ2V0Q2x1c3RlclByb3BlcnRpZXMoY2x1c3RlciksXG4gICAgICAgIGdlb21ldHJ5OiB7XG4gICAgICAgICAgICB0eXBlOiAnUG9pbnQnLFxuICAgICAgICAgICAgY29vcmRpbmF0ZXM6IFt4TG5nKGNsdXN0ZXIueCksIHlMYXQoY2x1c3Rlci55KV1cbiAgICAgICAgfVxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGdldENsdXN0ZXJQcm9wZXJ0aWVzKGNsdXN0ZXIpIHtcbiAgICBjb25zdCBjb3VudCA9IGNsdXN0ZXIubnVtUG9pbnRzO1xuICAgIGNvbnN0IGFiYnJldiA9XG4gICAgICAgIGNvdW50ID49IDEwMDAwID8gYCR7TWF0aC5yb3VuZChjb3VudCAvIDEwMDApICB9a2AgOlxuICAgICAgICBjb3VudCA+PSAxMDAwID8gYCR7TWF0aC5yb3VuZChjb3VudCAvIDEwMCkgLyAxMCAgfWtgIDogY291bnQ7XG4gICAgcmV0dXJuIGV4dGVuZChleHRlbmQoe30sIGNsdXN0ZXIucHJvcGVydGllcyksIHtcbiAgICAgICAgY2x1c3RlcjogdHJ1ZSxcbiAgICAgICAgY2x1c3Rlcl9pZDogY2x1c3Rlci5pZCxcbiAgICAgICAgcG9pbnRfY291bnQ6IGNvdW50LFxuICAgICAgICBwb2ludF9jb3VudF9hYmJyZXZpYXRlZDogYWJicmV2XG4gICAgfSk7XG59XG5cbi8vIGxvbmdpdHVkZS9sYXRpdHVkZSB0byBzcGhlcmljYWwgbWVyY2F0b3IgaW4gWzAuLjFdIHJhbmdlXG5mdW5jdGlvbiBsbmdYKGxuZykge1xuICAgIHJldHVybiBsbmcgLyAzNjAgKyAwLjU7XG59XG5mdW5jdGlvbiBsYXRZKGxhdCkge1xuICAgIGNvbnN0IHNpbiA9IE1hdGguc2luKGxhdCAqIE1hdGguUEkgLyAxODApO1xuICAgIGNvbnN0IHkgPSAoMC41IC0gMC4yNSAqIE1hdGgubG9nKCgxICsgc2luKSAvICgxIC0gc2luKSkgLyBNYXRoLlBJKTtcbiAgICByZXR1cm4geSA8IDAgPyAwIDogeSA+IDEgPyAxIDogeTtcbn1cblxuLy8gc3BoZXJpY2FsIG1lcmNhdG9yIHRvIGxvbmdpdHVkZS9sYXRpdHVkZVxuZnVuY3Rpb24geExuZyh4KSB7XG4gICAgcmV0dXJuICh4IC0gMC41KSAqIDM2MDtcbn1cbmZ1bmN0aW9uIHlMYXQoeSkge1xuICAgIGNvbnN0IHkyID0gKDE4MCAtIHkgKiAzNjApICogTWF0aC5QSSAvIDE4MDtcbiAgICByZXR1cm4gMzYwICogTWF0aC5hdGFuKE1hdGguZXhwKHkyKSkgLyBNYXRoLlBJIC0gOTA7XG59XG5cbmZ1bmN0aW9uIGV4dGVuZChkZXN0LCBzcmMpIHtcbiAgICBmb3IgKGNvbnN0IGlkIGluIHNyYykgZGVzdFtpZF0gPSBzcmNbaWRdO1xuICAgIHJldHVybiBkZXN0O1xufVxuXG5mdW5jdGlvbiBnZXRYKHApIHtcbiAgICByZXR1cm4gcC54O1xufVxuZnVuY3Rpb24gZ2V0WShwKSB7XG4gICAgcmV0dXJuIHAueTtcbn1cbiIsIlxuLy8gY2FsY3VsYXRlIHNpbXBsaWZpY2F0aW9uIGRhdGEgdXNpbmcgb3B0aW1pemVkIERvdWdsYXMtUGV1Y2tlciBhbGdvcml0aG1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gc2ltcGxpZnkoY29vcmRzLCBmaXJzdCwgbGFzdCwgc3FUb2xlcmFuY2UpIHtcbiAgICB2YXIgbWF4U3FEaXN0ID0gc3FUb2xlcmFuY2U7XG4gICAgdmFyIG1pZCA9IChsYXN0IC0gZmlyc3QpID4+IDE7XG4gICAgdmFyIG1pblBvc1RvTWlkID0gbGFzdCAtIGZpcnN0O1xuICAgIHZhciBpbmRleDtcblxuICAgIHZhciBheCA9IGNvb3Jkc1tmaXJzdF07XG4gICAgdmFyIGF5ID0gY29vcmRzW2ZpcnN0ICsgMV07XG4gICAgdmFyIGJ4ID0gY29vcmRzW2xhc3RdO1xuICAgIHZhciBieSA9IGNvb3Jkc1tsYXN0ICsgMV07XG5cbiAgICBmb3IgKHZhciBpID0gZmlyc3QgKyAzOyBpIDwgbGFzdDsgaSArPSAzKSB7XG4gICAgICAgIHZhciBkID0gZ2V0U3FTZWdEaXN0KGNvb3Jkc1tpXSwgY29vcmRzW2kgKyAxXSwgYXgsIGF5LCBieCwgYnkpO1xuXG4gICAgICAgIGlmIChkID4gbWF4U3FEaXN0KSB7XG4gICAgICAgICAgICBpbmRleCA9IGk7XG4gICAgICAgICAgICBtYXhTcURpc3QgPSBkO1xuXG4gICAgICAgIH0gZWxzZSBpZiAoZCA9PT0gbWF4U3FEaXN0KSB7XG4gICAgICAgICAgICAvLyBhIHdvcmthcm91bmQgdG8gZW5zdXJlIHdlIGNob29zZSBhIHBpdm90IGNsb3NlIHRvIHRoZSBtaWRkbGUgb2YgdGhlIGxpc3QsXG4gICAgICAgICAgICAvLyByZWR1Y2luZyByZWN1cnNpb24gZGVwdGgsIGZvciBjZXJ0YWluIGRlZ2VuZXJhdGUgaW5wdXRzXG4gICAgICAgICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vbWFwYm94L2dlb2pzb24tdnQvaXNzdWVzLzEwNFxuICAgICAgICAgICAgdmFyIHBvc1RvTWlkID0gTWF0aC5hYnMoaSAtIG1pZCk7XG4gICAgICAgICAgICBpZiAocG9zVG9NaWQgPCBtaW5Qb3NUb01pZCkge1xuICAgICAgICAgICAgICAgIGluZGV4ID0gaTtcbiAgICAgICAgICAgICAgICBtaW5Qb3NUb01pZCA9IHBvc1RvTWlkO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG1heFNxRGlzdCA+IHNxVG9sZXJhbmNlKSB7XG4gICAgICAgIGlmIChpbmRleCAtIGZpcnN0ID4gMykgc2ltcGxpZnkoY29vcmRzLCBmaXJzdCwgaW5kZXgsIHNxVG9sZXJhbmNlKTtcbiAgICAgICAgY29vcmRzW2luZGV4ICsgMl0gPSBtYXhTcURpc3Q7XG4gICAgICAgIGlmIChsYXN0IC0gaW5kZXggPiAzKSBzaW1wbGlmeShjb29yZHMsIGluZGV4LCBsYXN0LCBzcVRvbGVyYW5jZSk7XG4gICAgfVxufVxuXG4vLyBzcXVhcmUgZGlzdGFuY2UgZnJvbSBhIHBvaW50IHRvIGEgc2VnbWVudFxuZnVuY3Rpb24gZ2V0U3FTZWdEaXN0KHB4LCBweSwgeCwgeSwgYngsIGJ5KSB7XG5cbiAgICB2YXIgZHggPSBieCAtIHg7XG4gICAgdmFyIGR5ID0gYnkgLSB5O1xuXG4gICAgaWYgKGR4ICE9PSAwIHx8IGR5ICE9PSAwKSB7XG5cbiAgICAgICAgdmFyIHQgPSAoKHB4IC0geCkgKiBkeCArIChweSAtIHkpICogZHkpIC8gKGR4ICogZHggKyBkeSAqIGR5KTtcblxuICAgICAgICBpZiAodCA+IDEpIHtcbiAgICAgICAgICAgIHggPSBieDtcbiAgICAgICAgICAgIHkgPSBieTtcblxuICAgICAgICB9IGVsc2UgaWYgKHQgPiAwKSB7XG4gICAgICAgICAgICB4ICs9IGR4ICogdDtcbiAgICAgICAgICAgIHkgKz0gZHkgKiB0O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZHggPSBweCAtIHg7XG4gICAgZHkgPSBweSAtIHk7XG5cbiAgICByZXR1cm4gZHggKiBkeCArIGR5ICogZHk7XG59XG4iLCJcbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGNyZWF0ZUZlYXR1cmUoaWQsIHR5cGUsIGdlb20sIHRhZ3MpIHtcbiAgICB2YXIgZmVhdHVyZSA9IHtcbiAgICAgICAgaWQ6IHR5cGVvZiBpZCA9PT0gJ3VuZGVmaW5lZCcgPyBudWxsIDogaWQsXG4gICAgICAgIHR5cGU6IHR5cGUsXG4gICAgICAgIGdlb21ldHJ5OiBnZW9tLFxuICAgICAgICB0YWdzOiB0YWdzLFxuICAgICAgICBtaW5YOiBJbmZpbml0eSxcbiAgICAgICAgbWluWTogSW5maW5pdHksXG4gICAgICAgIG1heFg6IC1JbmZpbml0eSxcbiAgICAgICAgbWF4WTogLUluZmluaXR5XG4gICAgfTtcbiAgICBjYWxjQkJveChmZWF0dXJlKTtcbiAgICByZXR1cm4gZmVhdHVyZTtcbn1cblxuZnVuY3Rpb24gY2FsY0JCb3goZmVhdHVyZSkge1xuICAgIHZhciBnZW9tID0gZmVhdHVyZS5nZW9tZXRyeTtcbiAgICB2YXIgdHlwZSA9IGZlYXR1cmUudHlwZTtcblxuICAgIGlmICh0eXBlID09PSAnUG9pbnQnIHx8IHR5cGUgPT09ICdNdWx0aVBvaW50JyB8fCB0eXBlID09PSAnTGluZVN0cmluZycpIHtcbiAgICAgICAgY2FsY0xpbmVCQm94KGZlYXR1cmUsIGdlb20pO1xuXG4gICAgfSBlbHNlIGlmICh0eXBlID09PSAnUG9seWdvbicgfHwgdHlwZSA9PT0gJ011bHRpTGluZVN0cmluZycpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBnZW9tLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBjYWxjTGluZUJCb3goZmVhdHVyZSwgZ2VvbVtpXSk7XG4gICAgICAgIH1cblxuICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ011bHRpUG9seWdvbicpIHtcbiAgICAgICAgZm9yIChpID0gMDsgaSA8IGdlb20ubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgZ2VvbVtpXS5sZW5ndGg7IGorKykge1xuICAgICAgICAgICAgICAgIGNhbGNMaW5lQkJveChmZWF0dXJlLCBnZW9tW2ldW2pdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gY2FsY0xpbmVCQm94KGZlYXR1cmUsIGdlb20pIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGdlb20ubGVuZ3RoOyBpICs9IDMpIHtcbiAgICAgICAgZmVhdHVyZS5taW5YID0gTWF0aC5taW4oZmVhdHVyZS5taW5YLCBnZW9tW2ldKTtcbiAgICAgICAgZmVhdHVyZS5taW5ZID0gTWF0aC5taW4oZmVhdHVyZS5taW5ZLCBnZW9tW2kgKyAxXSk7XG4gICAgICAgIGZlYXR1cmUubWF4WCA9IE1hdGgubWF4KGZlYXR1cmUubWF4WCwgZ2VvbVtpXSk7XG4gICAgICAgIGZlYXR1cmUubWF4WSA9IE1hdGgubWF4KGZlYXR1cmUubWF4WSwgZ2VvbVtpICsgMV0pO1xuICAgIH1cbn1cbiIsIlxuaW1wb3J0IHNpbXBsaWZ5IGZyb20gJy4vc2ltcGxpZnknO1xuaW1wb3J0IGNyZWF0ZUZlYXR1cmUgZnJvbSAnLi9mZWF0dXJlJztcblxuLy8gY29udmVydHMgR2VvSlNPTiBmZWF0dXJlIGludG8gYW4gaW50ZXJtZWRpYXRlIHByb2plY3RlZCBKU09OIHZlY3RvciBmb3JtYXQgd2l0aCBzaW1wbGlmaWNhdGlvbiBkYXRhXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGNvbnZlcnQoZGF0YSwgb3B0aW9ucykge1xuICAgIHZhciBmZWF0dXJlcyA9IFtdO1xuICAgIGlmIChkYXRhLnR5cGUgPT09ICdGZWF0dXJlQ29sbGVjdGlvbicpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBkYXRhLmZlYXR1cmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBjb252ZXJ0RmVhdHVyZShmZWF0dXJlcywgZGF0YS5mZWF0dXJlc1tpXSwgb3B0aW9ucywgaSk7XG4gICAgICAgIH1cblxuICAgIH0gZWxzZSBpZiAoZGF0YS50eXBlID09PSAnRmVhdHVyZScpIHtcbiAgICAgICAgY29udmVydEZlYXR1cmUoZmVhdHVyZXMsIGRhdGEsIG9wdGlvbnMpO1xuXG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gc2luZ2xlIGdlb21ldHJ5IG9yIGEgZ2VvbWV0cnkgY29sbGVjdGlvblxuICAgICAgICBjb252ZXJ0RmVhdHVyZShmZWF0dXJlcywge2dlb21ldHJ5OiBkYXRhfSwgb3B0aW9ucyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZlYXR1cmVzO1xufVxuXG5mdW5jdGlvbiBjb252ZXJ0RmVhdHVyZShmZWF0dXJlcywgZ2VvanNvbiwgb3B0aW9ucywgaW5kZXgpIHtcbiAgICBpZiAoIWdlb2pzb24uZ2VvbWV0cnkpIHJldHVybjtcblxuICAgIHZhciBjb29yZHMgPSBnZW9qc29uLmdlb21ldHJ5LmNvb3JkaW5hdGVzO1xuICAgIHZhciB0eXBlID0gZ2VvanNvbi5nZW9tZXRyeS50eXBlO1xuICAgIHZhciB0b2xlcmFuY2UgPSBNYXRoLnBvdyhvcHRpb25zLnRvbGVyYW5jZSAvICgoMSA8PCBvcHRpb25zLm1heFpvb20pICogb3B0aW9ucy5leHRlbnQpLCAyKTtcbiAgICB2YXIgZ2VvbWV0cnkgPSBbXTtcbiAgICB2YXIgaWQgPSBnZW9qc29uLmlkO1xuICAgIGlmIChvcHRpb25zLnByb21vdGVJZCkge1xuICAgICAgICBpZCA9IGdlb2pzb24ucHJvcGVydGllc1tvcHRpb25zLnByb21vdGVJZF07XG4gICAgfSBlbHNlIGlmIChvcHRpb25zLmdlbmVyYXRlSWQpIHtcbiAgICAgICAgaWQgPSBpbmRleCB8fCAwO1xuICAgIH1cbiAgICBpZiAodHlwZSA9PT0gJ1BvaW50Jykge1xuICAgICAgICBjb252ZXJ0UG9pbnQoY29vcmRzLCBnZW9tZXRyeSk7XG5cbiAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdNdWx0aVBvaW50Jykge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNvb3Jkcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY29udmVydFBvaW50KGNvb3Jkc1tpXSwgZ2VvbWV0cnkpO1xuICAgICAgICB9XG5cbiAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdMaW5lU3RyaW5nJykge1xuICAgICAgICBjb252ZXJ0TGluZShjb29yZHMsIGdlb21ldHJ5LCB0b2xlcmFuY2UsIGZhbHNlKTtcblxuICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ011bHRpTGluZVN0cmluZycpIHtcbiAgICAgICAgaWYgKG9wdGlvbnMubGluZU1ldHJpY3MpIHtcbiAgICAgICAgICAgIC8vIGV4cGxvZGUgaW50byBsaW5lc3RyaW5ncyB0byBiZSBhYmxlIHRvIHRyYWNrIG1ldHJpY3NcbiAgICAgICAgICAgIGZvciAoaSA9IDA7IGkgPCBjb29yZHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICBnZW9tZXRyeSA9IFtdO1xuICAgICAgICAgICAgICAgIGNvbnZlcnRMaW5lKGNvb3Jkc1tpXSwgZ2VvbWV0cnksIHRvbGVyYW5jZSwgZmFsc2UpO1xuICAgICAgICAgICAgICAgIGZlYXR1cmVzLnB1c2goY3JlYXRlRmVhdHVyZShpZCwgJ0xpbmVTdHJpbmcnLCBnZW9tZXRyeSwgZ2VvanNvbi5wcm9wZXJ0aWVzKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb252ZXJ0TGluZXMoY29vcmRzLCBnZW9tZXRyeSwgdG9sZXJhbmNlLCBmYWxzZSk7XG4gICAgICAgIH1cblxuICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ1BvbHlnb24nKSB7XG4gICAgICAgIGNvbnZlcnRMaW5lcyhjb29yZHMsIGdlb21ldHJ5LCB0b2xlcmFuY2UsIHRydWUpO1xuXG4gICAgfSBlbHNlIGlmICh0eXBlID09PSAnTXVsdGlQb2x5Z29uJykge1xuICAgICAgICBmb3IgKGkgPSAwOyBpIDwgY29vcmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgcG9seWdvbiA9IFtdO1xuICAgICAgICAgICAgY29udmVydExpbmVzKGNvb3Jkc1tpXSwgcG9seWdvbiwgdG9sZXJhbmNlLCB0cnVlKTtcbiAgICAgICAgICAgIGdlb21ldHJ5LnB1c2gocG9seWdvbik7XG4gICAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdHZW9tZXRyeUNvbGxlY3Rpb24nKSB7XG4gICAgICAgIGZvciAoaSA9IDA7IGkgPCBnZW9qc29uLmdlb21ldHJ5Lmdlb21ldHJpZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGNvbnZlcnRGZWF0dXJlKGZlYXR1cmVzLCB7XG4gICAgICAgICAgICAgICAgaWQ6IGlkLFxuICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBnZW9qc29uLmdlb21ldHJ5Lmdlb21ldHJpZXNbaV0sXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczogZ2VvanNvbi5wcm9wZXJ0aWVzXG4gICAgICAgICAgICB9LCBvcHRpb25zLCBpbmRleCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignSW5wdXQgZGF0YSBpcyBub3QgYSB2YWxpZCBHZW9KU09OIG9iamVjdC4nKTtcbiAgICB9XG5cbiAgICBmZWF0dXJlcy5wdXNoKGNyZWF0ZUZlYXR1cmUoaWQsIHR5cGUsIGdlb21ldHJ5LCBnZW9qc29uLnByb3BlcnRpZXMpKTtcbn1cblxuZnVuY3Rpb24gY29udmVydFBvaW50KGNvb3Jkcywgb3V0KSB7XG4gICAgb3V0LnB1c2gocHJvamVjdFgoY29vcmRzWzBdKSk7XG4gICAgb3V0LnB1c2gocHJvamVjdFkoY29vcmRzWzFdKSk7XG4gICAgb3V0LnB1c2goMCk7XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRMaW5lKHJpbmcsIG91dCwgdG9sZXJhbmNlLCBpc1BvbHlnb24pIHtcbiAgICB2YXIgeDAsIHkwO1xuICAgIHZhciBzaXplID0gMDtcblxuICAgIGZvciAodmFyIGogPSAwOyBqIDwgcmluZy5sZW5ndGg7IGorKykge1xuICAgICAgICB2YXIgeCA9IHByb2plY3RYKHJpbmdbal1bMF0pO1xuICAgICAgICB2YXIgeSA9IHByb2plY3RZKHJpbmdbal1bMV0pO1xuXG4gICAgICAgIG91dC5wdXNoKHgpO1xuICAgICAgICBvdXQucHVzaCh5KTtcbiAgICAgICAgb3V0LnB1c2goMCk7XG5cbiAgICAgICAgaWYgKGogPiAwKSB7XG4gICAgICAgICAgICBpZiAoaXNQb2x5Z29uKSB7XG4gICAgICAgICAgICAgICAgc2l6ZSArPSAoeDAgKiB5IC0geCAqIHkwKSAvIDI7IC8vIGFyZWFcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc2l6ZSArPSBNYXRoLnNxcnQoTWF0aC5wb3coeCAtIHgwLCAyKSArIE1hdGgucG93KHkgLSB5MCwgMikpOyAvLyBsZW5ndGhcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB4MCA9IHg7XG4gICAgICAgIHkwID0geTtcbiAgICB9XG5cbiAgICB2YXIgbGFzdCA9IG91dC5sZW5ndGggLSAzO1xuICAgIG91dFsyXSA9IDE7XG4gICAgc2ltcGxpZnkob3V0LCAwLCBsYXN0LCB0b2xlcmFuY2UpO1xuICAgIG91dFtsYXN0ICsgMl0gPSAxO1xuXG4gICAgb3V0LnNpemUgPSBNYXRoLmFicyhzaXplKTtcbiAgICBvdXQuc3RhcnQgPSAwO1xuICAgIG91dC5lbmQgPSBvdXQuc2l6ZTtcbn1cblxuZnVuY3Rpb24gY29udmVydExpbmVzKHJpbmdzLCBvdXQsIHRvbGVyYW5jZSwgaXNQb2x5Z29uKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCByaW5ncy5sZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgZ2VvbSA9IFtdO1xuICAgICAgICBjb252ZXJ0TGluZShyaW5nc1tpXSwgZ2VvbSwgdG9sZXJhbmNlLCBpc1BvbHlnb24pO1xuICAgICAgICBvdXQucHVzaChnZW9tKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHByb2plY3RYKHgpIHtcbiAgICByZXR1cm4geCAvIDM2MCArIDAuNTtcbn1cblxuZnVuY3Rpb24gcHJvamVjdFkoeSkge1xuICAgIHZhciBzaW4gPSBNYXRoLnNpbih5ICogTWF0aC5QSSAvIDE4MCk7XG4gICAgdmFyIHkyID0gMC41IC0gMC4yNSAqIE1hdGgubG9nKCgxICsgc2luKSAvICgxIC0gc2luKSkgLyBNYXRoLlBJO1xuICAgIHJldHVybiB5MiA8IDAgPyAwIDogeTIgPiAxID8gMSA6IHkyO1xufVxuIiwiXG5pbXBvcnQgY3JlYXRlRmVhdHVyZSBmcm9tICcuL2ZlYXR1cmUnO1xuXG4vKiBjbGlwIGZlYXR1cmVzIGJldHdlZW4gdHdvIGF4aXMtcGFyYWxsZWwgbGluZXM6XG4gKiAgICAgfCAgICAgICAgfFxuICogIF9fX3xfX18gICAgIHwgICAgIC9cbiAqIC8gICB8ICAgXFxfX19ffF9fX18vXG4gKiAgICAgfCAgICAgICAgfFxuICovXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGNsaXAoZmVhdHVyZXMsIHNjYWxlLCBrMSwgazIsIGF4aXMsIG1pbkFsbCwgbWF4QWxsLCBvcHRpb25zKSB7XG5cbiAgICBrMSAvPSBzY2FsZTtcbiAgICBrMiAvPSBzY2FsZTtcblxuICAgIGlmIChtaW5BbGwgPj0gazEgJiYgbWF4QWxsIDwgazIpIHJldHVybiBmZWF0dXJlczsgLy8gdHJpdmlhbCBhY2NlcHRcbiAgICBlbHNlIGlmIChtYXhBbGwgPCBrMSB8fCBtaW5BbGwgPj0gazIpIHJldHVybiBudWxsOyAvLyB0cml2aWFsIHJlamVjdFxuXG4gICAgdmFyIGNsaXBwZWQgPSBbXTtcblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmVhdHVyZXMubGVuZ3RoOyBpKyspIHtcblxuICAgICAgICB2YXIgZmVhdHVyZSA9IGZlYXR1cmVzW2ldO1xuICAgICAgICB2YXIgZ2VvbWV0cnkgPSBmZWF0dXJlLmdlb21ldHJ5O1xuICAgICAgICB2YXIgdHlwZSA9IGZlYXR1cmUudHlwZTtcblxuICAgICAgICB2YXIgbWluID0gYXhpcyA9PT0gMCA/IGZlYXR1cmUubWluWCA6IGZlYXR1cmUubWluWTtcbiAgICAgICAgdmFyIG1heCA9IGF4aXMgPT09IDAgPyBmZWF0dXJlLm1heFggOiBmZWF0dXJlLm1heFk7XG5cbiAgICAgICAgaWYgKG1pbiA+PSBrMSAmJiBtYXggPCBrMikgeyAvLyB0cml2aWFsIGFjY2VwdFxuICAgICAgICAgICAgY2xpcHBlZC5wdXNoKGZlYXR1cmUpO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH0gZWxzZSBpZiAobWF4IDwgazEgfHwgbWluID49IGsyKSB7IC8vIHRyaXZpYWwgcmVqZWN0XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBuZXdHZW9tZXRyeSA9IFtdO1xuXG4gICAgICAgIGlmICh0eXBlID09PSAnUG9pbnQnIHx8IHR5cGUgPT09ICdNdWx0aVBvaW50Jykge1xuICAgICAgICAgICAgY2xpcFBvaW50cyhnZW9tZXRyeSwgbmV3R2VvbWV0cnksIGsxLCBrMiwgYXhpcyk7XG5cbiAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnTGluZVN0cmluZycpIHtcbiAgICAgICAgICAgIGNsaXBMaW5lKGdlb21ldHJ5LCBuZXdHZW9tZXRyeSwgazEsIGsyLCBheGlzLCBmYWxzZSwgb3B0aW9ucy5saW5lTWV0cmljcyk7XG5cbiAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnTXVsdGlMaW5lU3RyaW5nJykge1xuICAgICAgICAgICAgY2xpcExpbmVzKGdlb21ldHJ5LCBuZXdHZW9tZXRyeSwgazEsIGsyLCBheGlzLCBmYWxzZSk7XG5cbiAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnUG9seWdvbicpIHtcbiAgICAgICAgICAgIGNsaXBMaW5lcyhnZW9tZXRyeSwgbmV3R2VvbWV0cnksIGsxLCBrMiwgYXhpcywgdHJ1ZSk7XG5cbiAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnTXVsdGlQb2x5Z29uJykge1xuICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBnZW9tZXRyeS5sZW5ndGg7IGorKykge1xuICAgICAgICAgICAgICAgIHZhciBwb2x5Z29uID0gW107XG4gICAgICAgICAgICAgICAgY2xpcExpbmVzKGdlb21ldHJ5W2pdLCBwb2x5Z29uLCBrMSwgazIsIGF4aXMsIHRydWUpO1xuICAgICAgICAgICAgICAgIGlmIChwb2x5Z29uLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICBuZXdHZW9tZXRyeS5wdXNoKHBvbHlnb24pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChuZXdHZW9tZXRyeS5sZW5ndGgpIHtcbiAgICAgICAgICAgIGlmIChvcHRpb25zLmxpbmVNZXRyaWNzICYmIHR5cGUgPT09ICdMaW5lU3RyaW5nJykge1xuICAgICAgICAgICAgICAgIGZvciAoaiA9IDA7IGogPCBuZXdHZW9tZXRyeS5sZW5ndGg7IGorKykge1xuICAgICAgICAgICAgICAgICAgICBjbGlwcGVkLnB1c2goY3JlYXRlRmVhdHVyZShmZWF0dXJlLmlkLCB0eXBlLCBuZXdHZW9tZXRyeVtqXSwgZmVhdHVyZS50YWdzKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAodHlwZSA9PT0gJ0xpbmVTdHJpbmcnIHx8IHR5cGUgPT09ICdNdWx0aUxpbmVTdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgaWYgKG5ld0dlb21ldHJ5Lmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgICAgICAgICAgICB0eXBlID0gJ0xpbmVTdHJpbmcnO1xuICAgICAgICAgICAgICAgICAgICBuZXdHZW9tZXRyeSA9IG5ld0dlb21ldHJ5WzBdO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGUgPSAnTXVsdGlMaW5lU3RyaW5nJztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodHlwZSA9PT0gJ1BvaW50JyB8fCB0eXBlID09PSAnTXVsdGlQb2ludCcpIHtcbiAgICAgICAgICAgICAgICB0eXBlID0gbmV3R2VvbWV0cnkubGVuZ3RoID09PSAzID8gJ1BvaW50JyA6ICdNdWx0aVBvaW50JztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY2xpcHBlZC5wdXNoKGNyZWF0ZUZlYXR1cmUoZmVhdHVyZS5pZCwgdHlwZSwgbmV3R2VvbWV0cnksIGZlYXR1cmUudGFncykpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGNsaXBwZWQubGVuZ3RoID8gY2xpcHBlZCA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGNsaXBQb2ludHMoZ2VvbSwgbmV3R2VvbSwgazEsIGsyLCBheGlzKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBnZW9tLmxlbmd0aDsgaSArPSAzKSB7XG4gICAgICAgIHZhciBhID0gZ2VvbVtpICsgYXhpc107XG5cbiAgICAgICAgaWYgKGEgPj0gazEgJiYgYSA8PSBrMikge1xuICAgICAgICAgICAgbmV3R2VvbS5wdXNoKGdlb21baV0pO1xuICAgICAgICAgICAgbmV3R2VvbS5wdXNoKGdlb21baSArIDFdKTtcbiAgICAgICAgICAgIG5ld0dlb20ucHVzaChnZW9tW2kgKyAyXSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGNsaXBMaW5lKGdlb20sIG5ld0dlb20sIGsxLCBrMiwgYXhpcywgaXNQb2x5Z29uLCB0cmFja01ldHJpY3MpIHtcblxuICAgIHZhciBzbGljZSA9IG5ld1NsaWNlKGdlb20pO1xuICAgIHZhciBpbnRlcnNlY3QgPSBheGlzID09PSAwID8gaW50ZXJzZWN0WCA6IGludGVyc2VjdFk7XG4gICAgdmFyIGxlbiA9IGdlb20uc3RhcnQ7XG4gICAgdmFyIHNlZ0xlbiwgdDtcblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZ2VvbS5sZW5ndGggLSAzOyBpICs9IDMpIHtcbiAgICAgICAgdmFyIGF4ID0gZ2VvbVtpXTtcbiAgICAgICAgdmFyIGF5ID0gZ2VvbVtpICsgMV07XG4gICAgICAgIHZhciBheiA9IGdlb21baSArIDJdO1xuICAgICAgICB2YXIgYnggPSBnZW9tW2kgKyAzXTtcbiAgICAgICAgdmFyIGJ5ID0gZ2VvbVtpICsgNF07XG4gICAgICAgIHZhciBhID0gYXhpcyA9PT0gMCA/IGF4IDogYXk7XG4gICAgICAgIHZhciBiID0gYXhpcyA9PT0gMCA/IGJ4IDogYnk7XG4gICAgICAgIHZhciBleGl0ZWQgPSBmYWxzZTtcblxuICAgICAgICBpZiAodHJhY2tNZXRyaWNzKSBzZWdMZW4gPSBNYXRoLnNxcnQoTWF0aC5wb3coYXggLSBieCwgMikgKyBNYXRoLnBvdyhheSAtIGJ5LCAyKSk7XG5cbiAgICAgICAgaWYgKGEgPCBrMSkge1xuICAgICAgICAgICAgLy8gLS0tfC0tPiAgfCAobGluZSBlbnRlcnMgdGhlIGNsaXAgcmVnaW9uIGZyb20gdGhlIGxlZnQpXG4gICAgICAgICAgICBpZiAoYiA+IGsxKSB7XG4gICAgICAgICAgICAgICAgdCA9IGludGVyc2VjdChzbGljZSwgYXgsIGF5LCBieCwgYnksIGsxKTtcbiAgICAgICAgICAgICAgICBpZiAodHJhY2tNZXRyaWNzKSBzbGljZS5zdGFydCA9IGxlbiArIHNlZ0xlbiAqIHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoYSA+IGsyKSB7XG4gICAgICAgICAgICAvLyB8ICA8LS18LS0tIChsaW5lIGVudGVycyB0aGUgY2xpcCByZWdpb24gZnJvbSB0aGUgcmlnaHQpXG4gICAgICAgICAgICBpZiAoYiA8IGsyKSB7XG4gICAgICAgICAgICAgICAgdCA9IGludGVyc2VjdChzbGljZSwgYXgsIGF5LCBieCwgYnksIGsyKTtcbiAgICAgICAgICAgICAgICBpZiAodHJhY2tNZXRyaWNzKSBzbGljZS5zdGFydCA9IGxlbiArIHNlZ0xlbiAqIHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBhZGRQb2ludChzbGljZSwgYXgsIGF5LCBheik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGIgPCBrMSAmJiBhID49IGsxKSB7XG4gICAgICAgICAgICAvLyA8LS18LS0tICB8IG9yIDwtLXwtLS0tLXwtLS0gKGxpbmUgZXhpdHMgdGhlIGNsaXAgcmVnaW9uIG9uIHRoZSBsZWZ0KVxuICAgICAgICAgICAgdCA9IGludGVyc2VjdChzbGljZSwgYXgsIGF5LCBieCwgYnksIGsxKTtcbiAgICAgICAgICAgIGV4aXRlZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGIgPiBrMiAmJiBhIDw9IGsyKSB7XG4gICAgICAgICAgICAvLyB8ICAtLS18LS0+IG9yIC0tLXwtLS0tLXwtLT4gKGxpbmUgZXhpdHMgdGhlIGNsaXAgcmVnaW9uIG9uIHRoZSByaWdodClcbiAgICAgICAgICAgIHQgPSBpbnRlcnNlY3Qoc2xpY2UsIGF4LCBheSwgYngsIGJ5LCBrMik7XG4gICAgICAgICAgICBleGl0ZWQgPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFpc1BvbHlnb24gJiYgZXhpdGVkKSB7XG4gICAgICAgICAgICBpZiAodHJhY2tNZXRyaWNzKSBzbGljZS5lbmQgPSBsZW4gKyBzZWdMZW4gKiB0O1xuICAgICAgICAgICAgbmV3R2VvbS5wdXNoKHNsaWNlKTtcbiAgICAgICAgICAgIHNsaWNlID0gbmV3U2xpY2UoZ2VvbSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodHJhY2tNZXRyaWNzKSBsZW4gKz0gc2VnTGVuO1xuICAgIH1cblxuICAgIC8vIGFkZCB0aGUgbGFzdCBwb2ludFxuICAgIHZhciBsYXN0ID0gZ2VvbS5sZW5ndGggLSAzO1xuICAgIGF4ID0gZ2VvbVtsYXN0XTtcbiAgICBheSA9IGdlb21bbGFzdCArIDFdO1xuICAgIGF6ID0gZ2VvbVtsYXN0ICsgMl07XG4gICAgYSA9IGF4aXMgPT09IDAgPyBheCA6IGF5O1xuICAgIGlmIChhID49IGsxICYmIGEgPD0gazIpIGFkZFBvaW50KHNsaWNlLCBheCwgYXksIGF6KTtcblxuICAgIC8vIGNsb3NlIHRoZSBwb2x5Z29uIGlmIGl0cyBlbmRwb2ludHMgYXJlIG5vdCB0aGUgc2FtZSBhZnRlciBjbGlwcGluZ1xuICAgIGxhc3QgPSBzbGljZS5sZW5ndGggLSAzO1xuICAgIGlmIChpc1BvbHlnb24gJiYgbGFzdCA+PSAzICYmIChzbGljZVtsYXN0XSAhPT0gc2xpY2VbMF0gfHwgc2xpY2VbbGFzdCArIDFdICE9PSBzbGljZVsxXSkpIHtcbiAgICAgICAgYWRkUG9pbnQoc2xpY2UsIHNsaWNlWzBdLCBzbGljZVsxXSwgc2xpY2VbMl0pO1xuICAgIH1cblxuICAgIC8vIGFkZCB0aGUgZmluYWwgc2xpY2VcbiAgICBpZiAoc2xpY2UubGVuZ3RoKSB7XG4gICAgICAgIG5ld0dlb20ucHVzaChzbGljZSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBuZXdTbGljZShsaW5lKSB7XG4gICAgdmFyIHNsaWNlID0gW107XG4gICAgc2xpY2Uuc2l6ZSA9IGxpbmUuc2l6ZTtcbiAgICBzbGljZS5zdGFydCA9IGxpbmUuc3RhcnQ7XG4gICAgc2xpY2UuZW5kID0gbGluZS5lbmQ7XG4gICAgcmV0dXJuIHNsaWNlO1xufVxuXG5mdW5jdGlvbiBjbGlwTGluZXMoZ2VvbSwgbmV3R2VvbSwgazEsIGsyLCBheGlzLCBpc1BvbHlnb24pIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGdlb20ubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY2xpcExpbmUoZ2VvbVtpXSwgbmV3R2VvbSwgazEsIGsyLCBheGlzLCBpc1BvbHlnb24sIGZhbHNlKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGFkZFBvaW50KG91dCwgeCwgeSwgeikge1xuICAgIG91dC5wdXNoKHgpO1xuICAgIG91dC5wdXNoKHkpO1xuICAgIG91dC5wdXNoKHopO1xufVxuXG5mdW5jdGlvbiBpbnRlcnNlY3RYKG91dCwgYXgsIGF5LCBieCwgYnksIHgpIHtcbiAgICB2YXIgdCA9ICh4IC0gYXgpIC8gKGJ4IC0gYXgpO1xuICAgIG91dC5wdXNoKHgpO1xuICAgIG91dC5wdXNoKGF5ICsgKGJ5IC0gYXkpICogdCk7XG4gICAgb3V0LnB1c2goMSk7XG4gICAgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGludGVyc2VjdFkob3V0LCBheCwgYXksIGJ4LCBieSwgeSkge1xuICAgIHZhciB0ID0gKHkgLSBheSkgLyAoYnkgLSBheSk7XG4gICAgb3V0LnB1c2goYXggKyAoYnggLSBheCkgKiB0KTtcbiAgICBvdXQucHVzaCh5KTtcbiAgICBvdXQucHVzaCgxKTtcbiAgICByZXR1cm4gdDtcbn1cbiIsIlxuaW1wb3J0IGNsaXAgZnJvbSAnLi9jbGlwJztcbmltcG9ydCBjcmVhdGVGZWF0dXJlIGZyb20gJy4vZmVhdHVyZSc7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHdyYXAoZmVhdHVyZXMsIG9wdGlvbnMpIHtcbiAgICB2YXIgYnVmZmVyID0gb3B0aW9ucy5idWZmZXIgLyBvcHRpb25zLmV4dGVudDtcbiAgICB2YXIgbWVyZ2VkID0gZmVhdHVyZXM7XG4gICAgdmFyIGxlZnQgID0gY2xpcChmZWF0dXJlcywgMSwgLTEgLSBidWZmZXIsIGJ1ZmZlciwgICAgIDAsIC0xLCAyLCBvcHRpb25zKTsgLy8gbGVmdCB3b3JsZCBjb3B5XG4gICAgdmFyIHJpZ2h0ID0gY2xpcChmZWF0dXJlcywgMSwgIDEgLSBidWZmZXIsIDIgKyBidWZmZXIsIDAsIC0xLCAyLCBvcHRpb25zKTsgLy8gcmlnaHQgd29ybGQgY29weVxuXG4gICAgaWYgKGxlZnQgfHwgcmlnaHQpIHtcbiAgICAgICAgbWVyZ2VkID0gY2xpcChmZWF0dXJlcywgMSwgLWJ1ZmZlciwgMSArIGJ1ZmZlciwgMCwgLTEsIDIsIG9wdGlvbnMpIHx8IFtdOyAvLyBjZW50ZXIgd29ybGQgY29weVxuXG4gICAgICAgIGlmIChsZWZ0KSBtZXJnZWQgPSBzaGlmdEZlYXR1cmVDb29yZHMobGVmdCwgMSkuY29uY2F0KG1lcmdlZCk7IC8vIG1lcmdlIGxlZnQgaW50byBjZW50ZXJcbiAgICAgICAgaWYgKHJpZ2h0KSBtZXJnZWQgPSBtZXJnZWQuY29uY2F0KHNoaWZ0RmVhdHVyZUNvb3JkcyhyaWdodCwgLTEpKTsgLy8gbWVyZ2UgcmlnaHQgaW50byBjZW50ZXJcbiAgICB9XG5cbiAgICByZXR1cm4gbWVyZ2VkO1xufVxuXG5mdW5jdGlvbiBzaGlmdEZlYXR1cmVDb29yZHMoZmVhdHVyZXMsIG9mZnNldCkge1xuICAgIHZhciBuZXdGZWF0dXJlcyA9IFtdO1xuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmZWF0dXJlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgZmVhdHVyZSA9IGZlYXR1cmVzW2ldLFxuICAgICAgICAgICAgdHlwZSA9IGZlYXR1cmUudHlwZTtcblxuICAgICAgICB2YXIgbmV3R2VvbWV0cnk7XG5cbiAgICAgICAgaWYgKHR5cGUgPT09ICdQb2ludCcgfHwgdHlwZSA9PT0gJ011bHRpUG9pbnQnIHx8IHR5cGUgPT09ICdMaW5lU3RyaW5nJykge1xuICAgICAgICAgICAgbmV3R2VvbWV0cnkgPSBzaGlmdENvb3JkcyhmZWF0dXJlLmdlb21ldHJ5LCBvZmZzZXQpO1xuXG4gICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ011bHRpTGluZVN0cmluZycgfHwgdHlwZSA9PT0gJ1BvbHlnb24nKSB7XG4gICAgICAgICAgICBuZXdHZW9tZXRyeSA9IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBmZWF0dXJlLmdlb21ldHJ5Lmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICAgICAgbmV3R2VvbWV0cnkucHVzaChzaGlmdENvb3JkcyhmZWF0dXJlLmdlb21ldHJ5W2pdLCBvZmZzZXQpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnTXVsdGlQb2x5Z29uJykge1xuICAgICAgICAgICAgbmV3R2VvbWV0cnkgPSBbXTtcbiAgICAgICAgICAgIGZvciAoaiA9IDA7IGogPCBmZWF0dXJlLmdlb21ldHJ5Lmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICAgICAgdmFyIG5ld1BvbHlnb24gPSBbXTtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBrID0gMDsgayA8IGZlYXR1cmUuZ2VvbWV0cnlbal0ubGVuZ3RoOyBrKyspIHtcbiAgICAgICAgICAgICAgICAgICAgbmV3UG9seWdvbi5wdXNoKHNoaWZ0Q29vcmRzKGZlYXR1cmUuZ2VvbWV0cnlbal1ba10sIG9mZnNldCkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBuZXdHZW9tZXRyeS5wdXNoKG5ld1BvbHlnb24pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgbmV3RmVhdHVyZXMucHVzaChjcmVhdGVGZWF0dXJlKGZlYXR1cmUuaWQsIHR5cGUsIG5ld0dlb21ldHJ5LCBmZWF0dXJlLnRhZ3MpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3RmVhdHVyZXM7XG59XG5cbmZ1bmN0aW9uIHNoaWZ0Q29vcmRzKHBvaW50cywgb2Zmc2V0KSB7XG4gICAgdmFyIG5ld1BvaW50cyA9IFtdO1xuICAgIG5ld1BvaW50cy5zaXplID0gcG9pbnRzLnNpemU7XG5cbiAgICBpZiAocG9pbnRzLnN0YXJ0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgbmV3UG9pbnRzLnN0YXJ0ID0gcG9pbnRzLnN0YXJ0O1xuICAgICAgICBuZXdQb2ludHMuZW5kID0gcG9pbnRzLmVuZDtcbiAgICB9XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBvaW50cy5sZW5ndGg7IGkgKz0gMykge1xuICAgICAgICBuZXdQb2ludHMucHVzaChwb2ludHNbaV0gKyBvZmZzZXQsIHBvaW50c1tpICsgMV0sIHBvaW50c1tpICsgMl0pO1xuICAgIH1cbiAgICByZXR1cm4gbmV3UG9pbnRzO1xufVxuIiwiXG4vLyBUcmFuc2Zvcm1zIHRoZSBjb29yZGluYXRlcyBvZiBlYWNoIGZlYXR1cmUgaW4gdGhlIGdpdmVuIHRpbGUgZnJvbVxuLy8gbWVyY2F0b3ItcHJvamVjdGVkIHNwYWNlIGludG8gKGV4dGVudCB4IGV4dGVudCkgdGlsZSBzcGFjZS5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHRyYW5zZm9ybVRpbGUodGlsZSwgZXh0ZW50KSB7XG4gICAgaWYgKHRpbGUudHJhbnNmb3JtZWQpIHJldHVybiB0aWxlO1xuXG4gICAgdmFyIHoyID0gMSA8PCB0aWxlLnosXG4gICAgICAgIHR4ID0gdGlsZS54LFxuICAgICAgICB0eSA9IHRpbGUueSxcbiAgICAgICAgaSwgaiwgaztcblxuICAgIGZvciAoaSA9IDA7IGkgPCB0aWxlLmZlYXR1cmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciBmZWF0dXJlID0gdGlsZS5mZWF0dXJlc1tpXSxcbiAgICAgICAgICAgIGdlb20gPSBmZWF0dXJlLmdlb21ldHJ5LFxuICAgICAgICAgICAgdHlwZSA9IGZlYXR1cmUudHlwZTtcblxuICAgICAgICBmZWF0dXJlLmdlb21ldHJ5ID0gW107XG5cbiAgICAgICAgaWYgKHR5cGUgPT09IDEpIHtcbiAgICAgICAgICAgIGZvciAoaiA9IDA7IGogPCBnZW9tLmxlbmd0aDsgaiArPSAyKSB7XG4gICAgICAgICAgICAgICAgZmVhdHVyZS5nZW9tZXRyeS5wdXNoKHRyYW5zZm9ybVBvaW50KGdlb21bal0sIGdlb21baiArIDFdLCBleHRlbnQsIHoyLCB0eCwgdHkpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZvciAoaiA9IDA7IGogPCBnZW9tLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICAgICAgdmFyIHJpbmcgPSBbXTtcbiAgICAgICAgICAgICAgICBmb3IgKGsgPSAwOyBrIDwgZ2VvbVtqXS5sZW5ndGg7IGsgKz0gMikge1xuICAgICAgICAgICAgICAgICAgICByaW5nLnB1c2godHJhbnNmb3JtUG9pbnQoZ2VvbVtqXVtrXSwgZ2VvbVtqXVtrICsgMV0sIGV4dGVudCwgejIsIHR4LCB0eSkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBmZWF0dXJlLmdlb21ldHJ5LnB1c2gocmluZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB0aWxlLnRyYW5zZm9ybWVkID0gdHJ1ZTtcblxuICAgIHJldHVybiB0aWxlO1xufVxuXG5mdW5jdGlvbiB0cmFuc2Zvcm1Qb2ludCh4LCB5LCBleHRlbnQsIHoyLCB0eCwgdHkpIHtcbiAgICByZXR1cm4gW1xuICAgICAgICBNYXRoLnJvdW5kKGV4dGVudCAqICh4ICogejIgLSB0eCkpLFxuICAgICAgICBNYXRoLnJvdW5kKGV4dGVudCAqICh5ICogejIgLSB0eSkpXTtcbn1cbiIsIlxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gY3JlYXRlVGlsZShmZWF0dXJlcywgeiwgdHgsIHR5LCBvcHRpb25zKSB7XG4gICAgdmFyIHRvbGVyYW5jZSA9IHogPT09IG9wdGlvbnMubWF4Wm9vbSA/IDAgOiBvcHRpb25zLnRvbGVyYW5jZSAvICgoMSA8PCB6KSAqIG9wdGlvbnMuZXh0ZW50KTtcbiAgICB2YXIgdGlsZSA9IHtcbiAgICAgICAgZmVhdHVyZXM6IFtdLFxuICAgICAgICBudW1Qb2ludHM6IDAsXG4gICAgICAgIG51bVNpbXBsaWZpZWQ6IDAsXG4gICAgICAgIG51bUZlYXR1cmVzOiAwLFxuICAgICAgICBzb3VyY2U6IG51bGwsXG4gICAgICAgIHg6IHR4LFxuICAgICAgICB5OiB0eSxcbiAgICAgICAgejogeixcbiAgICAgICAgdHJhbnNmb3JtZWQ6IGZhbHNlLFxuICAgICAgICBtaW5YOiAyLFxuICAgICAgICBtaW5ZOiAxLFxuICAgICAgICBtYXhYOiAtMSxcbiAgICAgICAgbWF4WTogMFxuICAgIH07XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmZWF0dXJlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICB0aWxlLm51bUZlYXR1cmVzKys7XG4gICAgICAgIGFkZEZlYXR1cmUodGlsZSwgZmVhdHVyZXNbaV0sIHRvbGVyYW5jZSwgb3B0aW9ucyk7XG5cbiAgICAgICAgdmFyIG1pblggPSBmZWF0dXJlc1tpXS5taW5YO1xuICAgICAgICB2YXIgbWluWSA9IGZlYXR1cmVzW2ldLm1pblk7XG4gICAgICAgIHZhciBtYXhYID0gZmVhdHVyZXNbaV0ubWF4WDtcbiAgICAgICAgdmFyIG1heFkgPSBmZWF0dXJlc1tpXS5tYXhZO1xuXG4gICAgICAgIGlmIChtaW5YIDwgdGlsZS5taW5YKSB0aWxlLm1pblggPSBtaW5YO1xuICAgICAgICBpZiAobWluWSA8IHRpbGUubWluWSkgdGlsZS5taW5ZID0gbWluWTtcbiAgICAgICAgaWYgKG1heFggPiB0aWxlLm1heFgpIHRpbGUubWF4WCA9IG1heFg7XG4gICAgICAgIGlmIChtYXhZID4gdGlsZS5tYXhZKSB0aWxlLm1heFkgPSBtYXhZO1xuICAgIH1cbiAgICByZXR1cm4gdGlsZTtcbn1cblxuZnVuY3Rpb24gYWRkRmVhdHVyZSh0aWxlLCBmZWF0dXJlLCB0b2xlcmFuY2UsIG9wdGlvbnMpIHtcblxuICAgIHZhciBnZW9tID0gZmVhdHVyZS5nZW9tZXRyeSxcbiAgICAgICAgdHlwZSA9IGZlYXR1cmUudHlwZSxcbiAgICAgICAgc2ltcGxpZmllZCA9IFtdO1xuXG4gICAgaWYgKHR5cGUgPT09ICdQb2ludCcgfHwgdHlwZSA9PT0gJ011bHRpUG9pbnQnKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZ2VvbS5sZW5ndGg7IGkgKz0gMykge1xuICAgICAgICAgICAgc2ltcGxpZmllZC5wdXNoKGdlb21baV0pO1xuICAgICAgICAgICAgc2ltcGxpZmllZC5wdXNoKGdlb21baSArIDFdKTtcbiAgICAgICAgICAgIHRpbGUubnVtUG9pbnRzKys7XG4gICAgICAgICAgICB0aWxlLm51bVNpbXBsaWZpZWQrKztcbiAgICAgICAgfVxuXG4gICAgfSBlbHNlIGlmICh0eXBlID09PSAnTGluZVN0cmluZycpIHtcbiAgICAgICAgYWRkTGluZShzaW1wbGlmaWVkLCBnZW9tLCB0aWxlLCB0b2xlcmFuY2UsIGZhbHNlLCBmYWxzZSk7XG5cbiAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdNdWx0aUxpbmVTdHJpbmcnIHx8IHR5cGUgPT09ICdQb2x5Z29uJykge1xuICAgICAgICBmb3IgKGkgPSAwOyBpIDwgZ2VvbS5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgYWRkTGluZShzaW1wbGlmaWVkLCBnZW9tW2ldLCB0aWxlLCB0b2xlcmFuY2UsIHR5cGUgPT09ICdQb2x5Z29uJywgaSA9PT0gMCk7XG4gICAgICAgIH1cblxuICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ011bHRpUG9seWdvbicpIHtcblxuICAgICAgICBmb3IgKHZhciBrID0gMDsgayA8IGdlb20ubGVuZ3RoOyBrKyspIHtcbiAgICAgICAgICAgIHZhciBwb2x5Z29uID0gZ2VvbVtrXTtcbiAgICAgICAgICAgIGZvciAoaSA9IDA7IGkgPCBwb2x5Z29uLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgYWRkTGluZShzaW1wbGlmaWVkLCBwb2x5Z29uW2ldLCB0aWxlLCB0b2xlcmFuY2UsIHRydWUsIGkgPT09IDApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHNpbXBsaWZpZWQubGVuZ3RoKSB7XG4gICAgICAgIHZhciB0YWdzID0gZmVhdHVyZS50YWdzIHx8IG51bGw7XG4gICAgICAgIGlmICh0eXBlID09PSAnTGluZVN0cmluZycgJiYgb3B0aW9ucy5saW5lTWV0cmljcykge1xuICAgICAgICAgICAgdGFncyA9IHt9O1xuICAgICAgICAgICAgZm9yICh2YXIga2V5IGluIGZlYXR1cmUudGFncykgdGFnc1trZXldID0gZmVhdHVyZS50YWdzW2tleV07XG4gICAgICAgICAgICB0YWdzWydtYXBib3hfY2xpcF9zdGFydCddID0gZ2VvbS5zdGFydCAvIGdlb20uc2l6ZTtcbiAgICAgICAgICAgIHRhZ3NbJ21hcGJveF9jbGlwX2VuZCddID0gZ2VvbS5lbmQgLyBnZW9tLnNpemU7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHRpbGVGZWF0dXJlID0ge1xuICAgICAgICAgICAgZ2VvbWV0cnk6IHNpbXBsaWZpZWQsXG4gICAgICAgICAgICB0eXBlOiB0eXBlID09PSAnUG9seWdvbicgfHwgdHlwZSA9PT0gJ011bHRpUG9seWdvbicgPyAzIDpcbiAgICAgICAgICAgICAgICB0eXBlID09PSAnTGluZVN0cmluZycgfHwgdHlwZSA9PT0gJ011bHRpTGluZVN0cmluZycgPyAyIDogMSxcbiAgICAgICAgICAgIHRhZ3M6IHRhZ3NcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKGZlYXR1cmUuaWQgIT09IG51bGwpIHtcbiAgICAgICAgICAgIHRpbGVGZWF0dXJlLmlkID0gZmVhdHVyZS5pZDtcbiAgICAgICAgfVxuICAgICAgICB0aWxlLmZlYXR1cmVzLnB1c2godGlsZUZlYXR1cmUpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gYWRkTGluZShyZXN1bHQsIGdlb20sIHRpbGUsIHRvbGVyYW5jZSwgaXNQb2x5Z29uLCBpc091dGVyKSB7XG4gICAgdmFyIHNxVG9sZXJhbmNlID0gdG9sZXJhbmNlICogdG9sZXJhbmNlO1xuXG4gICAgaWYgKHRvbGVyYW5jZSA+IDAgJiYgKGdlb20uc2l6ZSA8IChpc1BvbHlnb24gPyBzcVRvbGVyYW5jZSA6IHRvbGVyYW5jZSkpKSB7XG4gICAgICAgIHRpbGUubnVtUG9pbnRzICs9IGdlb20ubGVuZ3RoIC8gMztcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciByaW5nID0gW107XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGdlb20ubGVuZ3RoOyBpICs9IDMpIHtcbiAgICAgICAgaWYgKHRvbGVyYW5jZSA9PT0gMCB8fCBnZW9tW2kgKyAyXSA+IHNxVG9sZXJhbmNlKSB7XG4gICAgICAgICAgICB0aWxlLm51bVNpbXBsaWZpZWQrKztcbiAgICAgICAgICAgIHJpbmcucHVzaChnZW9tW2ldKTtcbiAgICAgICAgICAgIHJpbmcucHVzaChnZW9tW2kgKyAxXSk7XG4gICAgICAgIH1cbiAgICAgICAgdGlsZS5udW1Qb2ludHMrKztcbiAgICB9XG5cbiAgICBpZiAoaXNQb2x5Z29uKSByZXdpbmQocmluZywgaXNPdXRlcik7XG5cbiAgICByZXN1bHQucHVzaChyaW5nKTtcbn1cblxuZnVuY3Rpb24gcmV3aW5kKHJpbmcsIGNsb2Nrd2lzZSkge1xuICAgIHZhciBhcmVhID0gMDtcbiAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gcmluZy5sZW5ndGgsIGogPSBsZW4gLSAyOyBpIDwgbGVuOyBqID0gaSwgaSArPSAyKSB7XG4gICAgICAgIGFyZWEgKz0gKHJpbmdbaV0gLSByaW5nW2pdKSAqIChyaW5nW2kgKyAxXSArIHJpbmdbaiArIDFdKTtcbiAgICB9XG4gICAgaWYgKGFyZWEgPiAwID09PSBjbG9ja3dpc2UpIHtcbiAgICAgICAgZm9yIChpID0gMCwgbGVuID0gcmluZy5sZW5ndGg7IGkgPCBsZW4gLyAyOyBpICs9IDIpIHtcbiAgICAgICAgICAgIHZhciB4ID0gcmluZ1tpXTtcbiAgICAgICAgICAgIHZhciB5ID0gcmluZ1tpICsgMV07XG4gICAgICAgICAgICByaW5nW2ldID0gcmluZ1tsZW4gLSAyIC0gaV07XG4gICAgICAgICAgICByaW5nW2kgKyAxXSA9IHJpbmdbbGVuIC0gMSAtIGldO1xuICAgICAgICAgICAgcmluZ1tsZW4gLSAyIC0gaV0gPSB4O1xuICAgICAgICAgICAgcmluZ1tsZW4gLSAxIC0gaV0gPSB5O1xuICAgICAgICB9XG4gICAgfVxufVxuIiwiXG5pbXBvcnQgY29udmVydCBmcm9tICcuL2NvbnZlcnQnOyAgICAgLy8gR2VvSlNPTiBjb252ZXJzaW9uIGFuZCBwcmVwcm9jZXNzaW5nXG5pbXBvcnQgY2xpcCBmcm9tICcuL2NsaXAnOyAgICAgICAgICAgLy8gc3RyaXBlIGNsaXBwaW5nIGFsZ29yaXRobVxuaW1wb3J0IHdyYXAgZnJvbSAnLi93cmFwJzsgICAgICAgICAgIC8vIGRhdGUgbGluZSBwcm9jZXNzaW5nXG5pbXBvcnQgdHJhbnNmb3JtIGZyb20gJy4vdHJhbnNmb3JtJzsgLy8gY29vcmRpbmF0ZSB0cmFuc2Zvcm1hdGlvblxuaW1wb3J0IGNyZWF0ZVRpbGUgZnJvbSAnLi90aWxlJzsgICAgIC8vIGZpbmFsIHNpbXBsaWZpZWQgdGlsZSBnZW5lcmF0aW9uXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGdlb2pzb252dChkYXRhLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIG5ldyBHZW9KU09OVlQoZGF0YSwgb3B0aW9ucyk7XG59XG5cbmZ1bmN0aW9uIEdlb0pTT05WVChkYXRhLCBvcHRpb25zKSB7XG4gICAgb3B0aW9ucyA9IHRoaXMub3B0aW9ucyA9IGV4dGVuZChPYmplY3QuY3JlYXRlKHRoaXMub3B0aW9ucyksIG9wdGlvbnMpO1xuXG4gICAgdmFyIGRlYnVnID0gb3B0aW9ucy5kZWJ1ZztcblxuICAgIGlmIChkZWJ1ZykgY29uc29sZS50aW1lKCdwcmVwcm9jZXNzIGRhdGEnKTtcblxuICAgIGlmIChvcHRpb25zLm1heFpvb20gPCAwIHx8IG9wdGlvbnMubWF4Wm9vbSA+IDI0KSB0aHJvdyBuZXcgRXJyb3IoJ21heFpvb20gc2hvdWxkIGJlIGluIHRoZSAwLTI0IHJhbmdlJyk7XG4gICAgaWYgKG9wdGlvbnMucHJvbW90ZUlkICYmIG9wdGlvbnMuZ2VuZXJhdGVJZCkgdGhyb3cgbmV3IEVycm9yKCdwcm9tb3RlSWQgYW5kIGdlbmVyYXRlSWQgY2Fubm90IGJlIHVzZWQgdG9nZXRoZXIuJyk7XG5cbiAgICB2YXIgZmVhdHVyZXMgPSBjb252ZXJ0KGRhdGEsIG9wdGlvbnMpO1xuXG4gICAgdGhpcy50aWxlcyA9IHt9O1xuICAgIHRoaXMudGlsZUNvb3JkcyA9IFtdO1xuXG4gICAgaWYgKGRlYnVnKSB7XG4gICAgICAgIGNvbnNvbGUudGltZUVuZCgncHJlcHJvY2VzcyBkYXRhJyk7XG4gICAgICAgIGNvbnNvbGUubG9nKCdpbmRleDogbWF4Wm9vbTogJWQsIG1heFBvaW50czogJWQnLCBvcHRpb25zLmluZGV4TWF4Wm9vbSwgb3B0aW9ucy5pbmRleE1heFBvaW50cyk7XG4gICAgICAgIGNvbnNvbGUudGltZSgnZ2VuZXJhdGUgdGlsZXMnKTtcbiAgICAgICAgdGhpcy5zdGF0cyA9IHt9O1xuICAgICAgICB0aGlzLnRvdGFsID0gMDtcbiAgICB9XG5cbiAgICBmZWF0dXJlcyA9IHdyYXAoZmVhdHVyZXMsIG9wdGlvbnMpO1xuXG4gICAgLy8gc3RhcnQgc2xpY2luZyBmcm9tIHRoZSB0b3AgdGlsZSBkb3duXG4gICAgaWYgKGZlYXR1cmVzLmxlbmd0aCkgdGhpcy5zcGxpdFRpbGUoZmVhdHVyZXMsIDAsIDAsIDApO1xuXG4gICAgaWYgKGRlYnVnKSB7XG4gICAgICAgIGlmIChmZWF0dXJlcy5sZW5ndGgpIGNvbnNvbGUubG9nKCdmZWF0dXJlczogJWQsIHBvaW50czogJWQnLCB0aGlzLnRpbGVzWzBdLm51bUZlYXR1cmVzLCB0aGlzLnRpbGVzWzBdLm51bVBvaW50cyk7XG4gICAgICAgIGNvbnNvbGUudGltZUVuZCgnZ2VuZXJhdGUgdGlsZXMnKTtcbiAgICAgICAgY29uc29sZS5sb2coJ3RpbGVzIGdlbmVyYXRlZDonLCB0aGlzLnRvdGFsLCBKU09OLnN0cmluZ2lmeSh0aGlzLnN0YXRzKSk7XG4gICAgfVxufVxuXG5HZW9KU09OVlQucHJvdG90eXBlLm9wdGlvbnMgPSB7XG4gICAgbWF4Wm9vbTogMTQsICAgICAgICAgICAgLy8gbWF4IHpvb20gdG8gcHJlc2VydmUgZGV0YWlsIG9uXG4gICAgaW5kZXhNYXhab29tOiA1LCAgICAgICAgLy8gbWF4IHpvb20gaW4gdGhlIHRpbGUgaW5kZXhcbiAgICBpbmRleE1heFBvaW50czogMTAwMDAwLCAvLyBtYXggbnVtYmVyIG9mIHBvaW50cyBwZXIgdGlsZSBpbiB0aGUgdGlsZSBpbmRleFxuICAgIHRvbGVyYW5jZTogMywgICAgICAgICAgIC8vIHNpbXBsaWZpY2F0aW9uIHRvbGVyYW5jZSAoaGlnaGVyIG1lYW5zIHNpbXBsZXIpXG4gICAgZXh0ZW50OiA0MDk2LCAgICAgICAgICAgLy8gdGlsZSBleHRlbnRcbiAgICBidWZmZXI6IDY0LCAgICAgICAgICAgICAvLyB0aWxlIGJ1ZmZlciBvbiBlYWNoIHNpZGVcbiAgICBsaW5lTWV0cmljczogZmFsc2UsICAgICAvLyB3aGV0aGVyIHRvIGNhbGN1bGF0ZSBsaW5lIG1ldHJpY3NcbiAgICBwcm9tb3RlSWQ6IG51bGwsICAgICAgICAvLyBuYW1lIG9mIGEgZmVhdHVyZSBwcm9wZXJ0eSB0byBiZSBwcm9tb3RlZCB0byBmZWF0dXJlLmlkXG4gICAgZ2VuZXJhdGVJZDogZmFsc2UsICAgICAgLy8gd2hldGhlciB0byBnZW5lcmF0ZSBmZWF0dXJlIGlkcy4gQ2Fubm90IGJlIHVzZWQgd2l0aCBwcm9tb3RlSWRcbiAgICBkZWJ1ZzogMCAgICAgICAgICAgICAgICAvLyBsb2dnaW5nIGxldmVsICgwLCAxIG9yIDIpXG59O1xuXG5HZW9KU09OVlQucHJvdG90eXBlLnNwbGl0VGlsZSA9IGZ1bmN0aW9uIChmZWF0dXJlcywgeiwgeCwgeSwgY3osIGN4LCBjeSkge1xuXG4gICAgdmFyIHN0YWNrID0gW2ZlYXR1cmVzLCB6LCB4LCB5XSxcbiAgICAgICAgb3B0aW9ucyA9IHRoaXMub3B0aW9ucyxcbiAgICAgICAgZGVidWcgPSBvcHRpb25zLmRlYnVnO1xuXG4gICAgLy8gYXZvaWQgcmVjdXJzaW9uIGJ5IHVzaW5nIGEgcHJvY2Vzc2luZyBxdWV1ZVxuICAgIHdoaWxlIChzdGFjay5sZW5ndGgpIHtcbiAgICAgICAgeSA9IHN0YWNrLnBvcCgpO1xuICAgICAgICB4ID0gc3RhY2sucG9wKCk7XG4gICAgICAgIHogPSBzdGFjay5wb3AoKTtcbiAgICAgICAgZmVhdHVyZXMgPSBzdGFjay5wb3AoKTtcblxuICAgICAgICB2YXIgejIgPSAxIDw8IHosXG4gICAgICAgICAgICBpZCA9IHRvSUQoeiwgeCwgeSksXG4gICAgICAgICAgICB0aWxlID0gdGhpcy50aWxlc1tpZF07XG5cbiAgICAgICAgaWYgKCF0aWxlKSB7XG4gICAgICAgICAgICBpZiAoZGVidWcgPiAxKSBjb25zb2xlLnRpbWUoJ2NyZWF0aW9uJyk7XG5cbiAgICAgICAgICAgIHRpbGUgPSB0aGlzLnRpbGVzW2lkXSA9IGNyZWF0ZVRpbGUoZmVhdHVyZXMsIHosIHgsIHksIG9wdGlvbnMpO1xuICAgICAgICAgICAgdGhpcy50aWxlQ29vcmRzLnB1c2goe3o6IHosIHg6IHgsIHk6IHl9KTtcblxuICAgICAgICAgICAgaWYgKGRlYnVnKSB7XG4gICAgICAgICAgICAgICAgaWYgKGRlYnVnID4gMSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygndGlsZSB6JWQtJWQtJWQgKGZlYXR1cmVzOiAlZCwgcG9pbnRzOiAlZCwgc2ltcGxpZmllZDogJWQpJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHosIHgsIHksIHRpbGUubnVtRmVhdHVyZXMsIHRpbGUubnVtUG9pbnRzLCB0aWxlLm51bVNpbXBsaWZpZWQpO1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLnRpbWVFbmQoJ2NyZWF0aW9uJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHZhciBrZXkgPSAneicgKyB6O1xuICAgICAgICAgICAgICAgIHRoaXMuc3RhdHNba2V5XSA9ICh0aGlzLnN0YXRzW2tleV0gfHwgMCkgKyAxO1xuICAgICAgICAgICAgICAgIHRoaXMudG90YWwrKztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHNhdmUgcmVmZXJlbmNlIHRvIG9yaWdpbmFsIGdlb21ldHJ5IGluIHRpbGUgc28gdGhhdCB3ZSBjYW4gZHJpbGwgZG93biBsYXRlciBpZiB3ZSBzdG9wIG5vd1xuICAgICAgICB0aWxlLnNvdXJjZSA9IGZlYXR1cmVzO1xuXG4gICAgICAgIC8vIGlmIGl0J3MgdGhlIGZpcnN0LXBhc3MgdGlsaW5nXG4gICAgICAgIGlmICghY3opIHtcbiAgICAgICAgICAgIC8vIHN0b3AgdGlsaW5nIGlmIHdlIHJlYWNoZWQgbWF4IHpvb20sIG9yIGlmIHRoZSB0aWxlIGlzIHRvbyBzaW1wbGVcbiAgICAgICAgICAgIGlmICh6ID09PSBvcHRpb25zLmluZGV4TWF4Wm9vbSB8fCB0aWxlLm51bVBvaW50cyA8PSBvcHRpb25zLmluZGV4TWF4UG9pbnRzKSBjb250aW51ZTtcblxuICAgICAgICAvLyBpZiBhIGRyaWxsZG93biB0byBhIHNwZWNpZmljIHRpbGVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIHN0b3AgdGlsaW5nIGlmIHdlIHJlYWNoZWQgYmFzZSB6b29tIG9yIG91ciB0YXJnZXQgdGlsZSB6b29tXG4gICAgICAgICAgICBpZiAoeiA9PT0gb3B0aW9ucy5tYXhab29tIHx8IHogPT09IGN6KSBjb250aW51ZTtcblxuICAgICAgICAgICAgLy8gc3RvcCB0aWxpbmcgaWYgaXQncyBub3QgYW4gYW5jZXN0b3Igb2YgdGhlIHRhcmdldCB0aWxlXG4gICAgICAgICAgICB2YXIgbSA9IDEgPDwgKGN6IC0geik7XG4gICAgICAgICAgICBpZiAoeCAhPT0gTWF0aC5mbG9vcihjeCAvIG0pIHx8IHkgIT09IE1hdGguZmxvb3IoY3kgLyBtKSkgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBpZiB3ZSBzbGljZSBmdXJ0aGVyIGRvd24sIG5vIG5lZWQgdG8ga2VlcCBzb3VyY2UgZ2VvbWV0cnlcbiAgICAgICAgdGlsZS5zb3VyY2UgPSBudWxsO1xuXG4gICAgICAgIGlmIChmZWF0dXJlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuXG4gICAgICAgIGlmIChkZWJ1ZyA+IDEpIGNvbnNvbGUudGltZSgnY2xpcHBpbmcnKTtcblxuICAgICAgICAvLyB2YWx1ZXMgd2UnbGwgdXNlIGZvciBjbGlwcGluZ1xuICAgICAgICB2YXIgazEgPSAwLjUgKiBvcHRpb25zLmJ1ZmZlciAvIG9wdGlvbnMuZXh0ZW50LFxuICAgICAgICAgICAgazIgPSAwLjUgLSBrMSxcbiAgICAgICAgICAgIGszID0gMC41ICsgazEsXG4gICAgICAgICAgICBrNCA9IDEgKyBrMSxcbiAgICAgICAgICAgIHRsLCBibCwgdHIsIGJyLCBsZWZ0LCByaWdodDtcblxuICAgICAgICB0bCA9IGJsID0gdHIgPSBiciA9IG51bGw7XG5cbiAgICAgICAgbGVmdCAgPSBjbGlwKGZlYXR1cmVzLCB6MiwgeCAtIGsxLCB4ICsgazMsIDAsIHRpbGUubWluWCwgdGlsZS5tYXhYLCBvcHRpb25zKTtcbiAgICAgICAgcmlnaHQgPSBjbGlwKGZlYXR1cmVzLCB6MiwgeCArIGsyLCB4ICsgazQsIDAsIHRpbGUubWluWCwgdGlsZS5tYXhYLCBvcHRpb25zKTtcbiAgICAgICAgZmVhdHVyZXMgPSBudWxsO1xuXG4gICAgICAgIGlmIChsZWZ0KSB7XG4gICAgICAgICAgICB0bCA9IGNsaXAobGVmdCwgejIsIHkgLSBrMSwgeSArIGszLCAxLCB0aWxlLm1pblksIHRpbGUubWF4WSwgb3B0aW9ucyk7XG4gICAgICAgICAgICBibCA9IGNsaXAobGVmdCwgejIsIHkgKyBrMiwgeSArIGs0LCAxLCB0aWxlLm1pblksIHRpbGUubWF4WSwgb3B0aW9ucyk7XG4gICAgICAgICAgICBsZWZ0ID0gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChyaWdodCkge1xuICAgICAgICAgICAgdHIgPSBjbGlwKHJpZ2h0LCB6MiwgeSAtIGsxLCB5ICsgazMsIDEsIHRpbGUubWluWSwgdGlsZS5tYXhZLCBvcHRpb25zKTtcbiAgICAgICAgICAgIGJyID0gY2xpcChyaWdodCwgejIsIHkgKyBrMiwgeSArIGs0LCAxLCB0aWxlLm1pblksIHRpbGUubWF4WSwgb3B0aW9ucyk7XG4gICAgICAgICAgICByaWdodCA9IG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZGVidWcgPiAxKSBjb25zb2xlLnRpbWVFbmQoJ2NsaXBwaW5nJyk7XG5cbiAgICAgICAgc3RhY2sucHVzaCh0bCB8fCBbXSwgeiArIDEsIHggKiAyLCAgICAgeSAqIDIpO1xuICAgICAgICBzdGFjay5wdXNoKGJsIHx8IFtdLCB6ICsgMSwgeCAqIDIsICAgICB5ICogMiArIDEpO1xuICAgICAgICBzdGFjay5wdXNoKHRyIHx8IFtdLCB6ICsgMSwgeCAqIDIgKyAxLCB5ICogMik7XG4gICAgICAgIHN0YWNrLnB1c2goYnIgfHwgW10sIHogKyAxLCB4ICogMiArIDEsIHkgKiAyICsgMSk7XG4gICAgfVxufTtcblxuR2VvSlNPTlZULnByb3RvdHlwZS5nZXRUaWxlID0gZnVuY3Rpb24gKHosIHgsIHkpIHtcbiAgICB2YXIgb3B0aW9ucyA9IHRoaXMub3B0aW9ucyxcbiAgICAgICAgZXh0ZW50ID0gb3B0aW9ucy5leHRlbnQsXG4gICAgICAgIGRlYnVnID0gb3B0aW9ucy5kZWJ1ZztcblxuICAgIGlmICh6IDwgMCB8fCB6ID4gMjQpIHJldHVybiBudWxsO1xuXG4gICAgdmFyIHoyID0gMSA8PCB6O1xuICAgIHggPSAoKHggJSB6MikgKyB6MikgJSB6MjsgLy8gd3JhcCB0aWxlIHggY29vcmRpbmF0ZVxuXG4gICAgdmFyIGlkID0gdG9JRCh6LCB4LCB5KTtcbiAgICBpZiAodGhpcy50aWxlc1tpZF0pIHJldHVybiB0cmFuc2Zvcm0odGhpcy50aWxlc1tpZF0sIGV4dGVudCk7XG5cbiAgICBpZiAoZGVidWcgPiAxKSBjb25zb2xlLmxvZygnZHJpbGxpbmcgZG93biB0byB6JWQtJWQtJWQnLCB6LCB4LCB5KTtcblxuICAgIHZhciB6MCA9IHosXG4gICAgICAgIHgwID0geCxcbiAgICAgICAgeTAgPSB5LFxuICAgICAgICBwYXJlbnQ7XG5cbiAgICB3aGlsZSAoIXBhcmVudCAmJiB6MCA+IDApIHtcbiAgICAgICAgejAtLTtcbiAgICAgICAgeDAgPSBNYXRoLmZsb29yKHgwIC8gMik7XG4gICAgICAgIHkwID0gTWF0aC5mbG9vcih5MCAvIDIpO1xuICAgICAgICBwYXJlbnQgPSB0aGlzLnRpbGVzW3RvSUQoejAsIHgwLCB5MCldO1xuICAgIH1cblxuICAgIGlmICghcGFyZW50IHx8ICFwYXJlbnQuc291cmNlKSByZXR1cm4gbnVsbDtcblxuICAgIC8vIGlmIHdlIGZvdW5kIGEgcGFyZW50IHRpbGUgY29udGFpbmluZyB0aGUgb3JpZ2luYWwgZ2VvbWV0cnksIHdlIGNhbiBkcmlsbCBkb3duIGZyb20gaXRcbiAgICBpZiAoZGVidWcgPiAxKSBjb25zb2xlLmxvZygnZm91bmQgcGFyZW50IHRpbGUgeiVkLSVkLSVkJywgejAsIHgwLCB5MCk7XG5cbiAgICBpZiAoZGVidWcgPiAxKSBjb25zb2xlLnRpbWUoJ2RyaWxsaW5nIGRvd24nKTtcbiAgICB0aGlzLnNwbGl0VGlsZShwYXJlbnQuc291cmNlLCB6MCwgeDAsIHkwLCB6LCB4LCB5KTtcbiAgICBpZiAoZGVidWcgPiAxKSBjb25zb2xlLnRpbWVFbmQoJ2RyaWxsaW5nIGRvd24nKTtcblxuICAgIHJldHVybiB0aGlzLnRpbGVzW2lkXSA/IHRyYW5zZm9ybSh0aGlzLnRpbGVzW2lkXSwgZXh0ZW50KSA6IG51bGw7XG59O1xuXG5mdW5jdGlvbiB0b0lEKHosIHgsIHkpIHtcbiAgICByZXR1cm4gKCgoMSA8PCB6KSAqIHkgKyB4KSAqIDMyKSArIHo7XG59XG5cbmZ1bmN0aW9uIGV4dGVuZChkZXN0LCBzcmMpIHtcbiAgICBmb3IgKHZhciBpIGluIHNyYykgZGVzdFtpXSA9IHNyY1tpXTtcbiAgICByZXR1cm4gZGVzdDtcbn1cbiIsIi8vIEBmbG93XG5cbmltcG9ydCB7Z2V0SlNPTn0gZnJvbSAnLi4vdXRpbC9hamF4JztcblxuaW1wb3J0IHtSZXF1ZXN0UGVyZm9ybWFuY2V9IGZyb20gJy4uL3V0aWwvcGVyZm9ybWFuY2UnO1xuaW1wb3J0IHJld2luZCBmcm9tICdAbWFwYm94L2dlb2pzb24tcmV3aW5kJztcbmltcG9ydCBHZW9KU09OV3JhcHBlciBmcm9tICcuL2dlb2pzb25fd3JhcHBlcic7XG5pbXBvcnQgdnRwYmYgZnJvbSAndnQtcGJmJztcbmltcG9ydCBTdXBlcmNsdXN0ZXIgZnJvbSAnc3VwZXJjbHVzdGVyJztcbmltcG9ydCBnZW9qc29udnQgZnJvbSAnZ2VvanNvbi12dCc7XG5pbXBvcnQgYXNzZXJ0IGZyb20gJ2Fzc2VydCc7XG5pbXBvcnQgVmVjdG9yVGlsZVdvcmtlclNvdXJjZSBmcm9tICcuL3ZlY3Rvcl90aWxlX3dvcmtlcl9zb3VyY2UnO1xuaW1wb3J0IHtjcmVhdGVFeHByZXNzaW9ufSBmcm9tICcuLi9zdHlsZS1zcGVjL2V4cHJlc3Npb24nO1xuXG5pbXBvcnQgdHlwZSB7XG4gICAgV29ya2VyVGlsZVBhcmFtZXRlcnMsXG4gICAgV29ya2VyVGlsZUNhbGxiYWNrLFxufSBmcm9tICcuLi9zb3VyY2Uvd29ya2VyX3NvdXJjZSc7XG5cbmltcG9ydCB0eXBlIEFjdG9yIGZyb20gJy4uL3V0aWwvYWN0b3InO1xuaW1wb3J0IHR5cGUgU3R5bGVMYXllckluZGV4IGZyb20gJy4uL3N0eWxlL3N0eWxlX2xheWVyX2luZGV4JztcblxuaW1wb3J0IHR5cGUge0xvYWRWZWN0b3JEYXRhQ2FsbGJhY2t9IGZyb20gJy4vdmVjdG9yX3RpbGVfd29ya2VyX3NvdXJjZSc7XG5pbXBvcnQgdHlwZSB7UmVxdWVzdFBhcmFtZXRlcnMsIFJlc3BvbnNlQ2FsbGJhY2t9IGZyb20gJy4uL3V0aWwvYWpheCc7XG5pbXBvcnQgdHlwZSB7Q2FsbGJhY2t9IGZyb20gJy4uL3R5cGVzL2NhbGxiYWNrJztcbmltcG9ydCB0eXBlIHtHZW9KU09ORmVhdHVyZX0gZnJvbSAnQG1hcGJveC9nZW9qc29uLXR5cGVzJztcblxuZXhwb3J0IHR5cGUgTG9hZEdlb0pTT05QYXJhbWV0ZXJzID0ge1xuICAgIHJlcXVlc3Q/OiBSZXF1ZXN0UGFyYW1ldGVycyxcbiAgICBkYXRhPzogc3RyaW5nLFxuICAgIHNvdXJjZTogc3RyaW5nLFxuICAgIGNsdXN0ZXI6IGJvb2xlYW4sXG4gICAgc3VwZXJjbHVzdGVyT3B0aW9ucz86IE9iamVjdCxcbiAgICBnZW9qc29uVnRPcHRpb25zPzogT2JqZWN0LFxuICAgIGNsdXN0ZXJQcm9wZXJ0aWVzPzogT2JqZWN0LFxuICAgIGZpbHRlcj86IEFycmF5PG1peGVkPlxufTtcblxuZXhwb3J0IHR5cGUgTG9hZEdlb0pTT04gPSAocGFyYW1zOiBMb2FkR2VvSlNPTlBhcmFtZXRlcnMsIGNhbGxiYWNrOiBSZXNwb25zZUNhbGxiYWNrPE9iamVjdD4pID0+IHZvaWQ7XG5cbmV4cG9ydCBpbnRlcmZhY2UgR2VvSlNPTkluZGV4IHtcbiAgICBnZXRUaWxlKHo6IG51bWJlciwgeDogbnVtYmVyLCB5OiBudW1iZXIpOiBPYmplY3Q7XG5cbiAgICAvLyBzdXBlcmNsdXN0ZXIgbWV0aG9kc1xuICAgIGdldENsdXN0ZXJFeHBhbnNpb25ab29tKGNsdXN0ZXJJZDogbnVtYmVyKTogbnVtYmVyO1xuICAgIGdldENoaWxkcmVuKGNsdXN0ZXJJZDogbnVtYmVyKTogQXJyYXk8R2VvSlNPTkZlYXR1cmU+O1xuICAgIGdldExlYXZlcyhjbHVzdGVySWQ6IG51bWJlciwgbGltaXQ6IG51bWJlciwgb2Zmc2V0OiBudW1iZXIpOiBBcnJheTxHZW9KU09ORmVhdHVyZT47XG59XG5cbmZ1bmN0aW9uIGxvYWRHZW9KU09OVGlsZShwYXJhbXM6IFdvcmtlclRpbGVQYXJhbWV0ZXJzLCBjYWxsYmFjazogTG9hZFZlY3RvckRhdGFDYWxsYmFjaykge1xuICAgIGNvbnN0IGNhbm9uaWNhbCA9IHBhcmFtcy50aWxlSUQuY2Fub25pY2FsO1xuXG4gICAgaWYgKCF0aGlzLl9nZW9KU09OSW5kZXgpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG51bGwsIG51bGwpOyAgLy8gd2UgY291bGRuJ3QgbG9hZCB0aGUgZmlsZVxuICAgIH1cblxuICAgIGNvbnN0IGdlb0pTT05UaWxlID0gdGhpcy5fZ2VvSlNPTkluZGV4LmdldFRpbGUoY2Fub25pY2FsLnosIGNhbm9uaWNhbC54LCBjYW5vbmljYWwueSk7XG4gICAgaWYgKCFnZW9KU09OVGlsZSkge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2sobnVsbCwgbnVsbCk7IC8vIG5vdGhpbmcgaW4gdGhlIGdpdmVuIHRpbGVcbiAgICB9XG5cbiAgICBjb25zdCBnZW9qc29uV3JhcHBlciA9IG5ldyBHZW9KU09OV3JhcHBlcihnZW9KU09OVGlsZS5mZWF0dXJlcyk7XG5cbiAgICAvLyBFbmNvZGUgdGhlIGdlb2pzb24tdnQgdGlsZSBpbnRvIGJpbmFyeSB2ZWN0b3IgdGlsZSBmb3JtLiAgVGhpc1xuICAgIC8vIGlzIGEgY29udmVuaWVuY2UgdGhhdCBhbGxvd3MgYEZlYXR1cmVJbmRleGAgdG8gb3BlcmF0ZSB0aGUgc2FtZSB3YXlcbiAgICAvLyBhY3Jvc3MgYFZlY3RvclRpbGVTb3VyY2VgIGFuZCBgR2VvSlNPTlNvdXJjZWAgZGF0YS5cbiAgICBsZXQgcGJmID0gdnRwYmYoZ2VvanNvbldyYXBwZXIpO1xuICAgIGlmIChwYmYuYnl0ZU9mZnNldCAhPT0gMCB8fCBwYmYuYnl0ZUxlbmd0aCAhPT0gcGJmLmJ1ZmZlci5ieXRlTGVuZ3RoKSB7XG4gICAgICAgIC8vIENvbXBhdGliaWxpdHkgd2l0aCBub2RlIEJ1ZmZlciAoaHR0cHM6Ly9naXRodWIuY29tL21hcGJveC9wYmYvaXNzdWVzLzM1KVxuICAgICAgICBwYmYgPSBuZXcgVWludDhBcnJheShwYmYpO1xuICAgIH1cblxuICAgIGNhbGxiYWNrKG51bGwsIHtcbiAgICAgICAgdmVjdG9yVGlsZTogZ2VvanNvbldyYXBwZXIsXG4gICAgICAgIHJhd0RhdGE6IHBiZi5idWZmZXJcbiAgICB9KTtcbn1cblxuZXhwb3J0IHR5cGUgU291cmNlU3RhdGUgPVxuICAgIHwgJ0lkbGUnICAgICAgICAgICAgLy8gU291cmNlIGVtcHR5IG9yIGRhdGEgbG9hZGVkXG4gICAgfCAnQ29hbGVzY2luZycgICAgICAvLyBEYXRhIGZpbmlzaGVkIGxvYWRpbmcsIGJ1dCBkaXNjYXJkICdsb2FkRGF0YScgbWVzc2FnZXMgdW50aWwgcmVjZWl2aW5nICdjb2FsZXNjZWQnXG4gICAgfCAnTmVlZHNMb2FkRGF0YSc7ICAvLyAnbG9hZERhdGEnIHJlY2VpdmVkIHdoaWxlIGNvYWxlc2NpbmcsIHRyaWdnZXIgb25lIG1vcmUgJ2xvYWREYXRhJyBvbiByZWNlaXZpbmcgJ2NvYWxlc2NlZCdcblxuLyoqXG4gKiBUaGUge0BsaW5rIFdvcmtlclNvdXJjZX0gaW1wbGVtZW50YXRpb24gdGhhdCBzdXBwb3J0cyB7QGxpbmsgR2VvSlNPTlNvdXJjZX0uXG4gKiBUaGlzIGNsYXNzIGlzIGRlc2lnbmVkIHRvIGJlIGVhc2lseSByZXVzZWQgdG8gc3VwcG9ydCBjdXN0b20gc291cmNlIHR5cGVzXG4gKiBmb3IgZGF0YSBmb3JtYXRzIHRoYXQgY2FuIGJlIHBhcnNlZC9jb252ZXJ0ZWQgaW50byBhbiBpbi1tZW1vcnkgR2VvSlNPTlxuICogcmVwcmVzZW50YXRpb24uICBUbyBkbyBzbywgY3JlYXRlIGl0IHdpdGhcbiAqIGBuZXcgR2VvSlNPTldvcmtlclNvdXJjZShhY3RvciwgbGF5ZXJJbmRleCwgY3VzdG9tTG9hZEdlb0pTT05GdW5jdGlvbilgLlxuICogRm9yIGEgZnVsbCBleGFtcGxlLCBzZWUgW21hcGJveC1nbC10b3BvanNvbl0oaHR0cHM6Ly9naXRodWIuY29tL2RldmVsb3BtZW50c2VlZC9tYXBib3gtZ2wtdG9wb2pzb24pLlxuICpcbiAqIEBwcml2YXRlXG4gKi9cbmNsYXNzIEdlb0pTT05Xb3JrZXJTb3VyY2UgZXh0ZW5kcyBWZWN0b3JUaWxlV29ya2VyU291cmNlIHtcbiAgICBsb2FkR2VvSlNPTjogTG9hZEdlb0pTT047XG4gICAgX3N0YXRlOiBTb3VyY2VTdGF0ZTtcbiAgICBfcGVuZGluZ0NhbGxiYWNrOiBDYWxsYmFjazx7XG4gICAgICAgIHJlc291cmNlVGltaW5nPzoge1tfOiBzdHJpbmddOiBBcnJheTxQZXJmb3JtYW5jZVJlc291cmNlVGltaW5nPn0sXG4gICAgICAgIGFiYW5kb25lZD86IGJvb2xlYW4gfT47XG4gICAgX3BlbmRpbmdMb2FkRGF0YVBhcmFtczogTG9hZEdlb0pTT05QYXJhbWV0ZXJzO1xuICAgIF9nZW9KU09OSW5kZXg6IEdlb0pTT05JbmRleFxuXG4gICAgLyoqXG4gICAgICogQHBhcmFtIFtsb2FkR2VvSlNPTl0gT3B0aW9uYWwgbWV0aG9kIGZvciBjdXN0b20gbG9hZGluZy9wYXJzaW5nIG9mXG4gICAgICogR2VvSlNPTiBiYXNlZCBvbiBwYXJhbWV0ZXJzIHBhc3NlZCBmcm9tIHRoZSBtYWluLXRocmVhZCBTb3VyY2UuXG4gICAgICogU2VlIHtAbGluayBHZW9KU09OV29ya2VyU291cmNlI2xvYWRHZW9KU09OfS5cbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKGFjdG9yOiBBY3RvciwgbGF5ZXJJbmRleDogU3R5bGVMYXllckluZGV4LCBhdmFpbGFibGVJbWFnZXM6IEFycmF5PHN0cmluZz4sIGxvYWRHZW9KU09OOiA/TG9hZEdlb0pTT04pIHtcbiAgICAgICAgc3VwZXIoYWN0b3IsIGxheWVySW5kZXgsIGF2YWlsYWJsZUltYWdlcywgbG9hZEdlb0pTT05UaWxlKTtcbiAgICAgICAgaWYgKGxvYWRHZW9KU09OKSB7XG4gICAgICAgICAgICB0aGlzLmxvYWRHZW9KU09OID0gbG9hZEdlb0pTT047XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBGZXRjaGVzIChpZiBhcHByb3ByaWF0ZSksIHBhcnNlcywgYW5kIGluZGV4IGdlb2pzb24gZGF0YSBpbnRvIHRpbGVzLiBUaGlzXG4gICAgICogcHJlcGFyYXRvcnkgbWV0aG9kIG11c3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgR2VvSlNPTldvcmtlclNvdXJjZSNsb2FkVGlsZX1cbiAgICAgKiBjYW4gY29ycmVjdGx5IHNlcnZlIHVwIHRpbGVzLlxuICAgICAqXG4gICAgICogRGVmZXJzIHRvIHtAbGluayBHZW9KU09OV29ya2VyU291cmNlI2xvYWRHZW9KU09OfSBmb3IgdGhlIGZldGNoaW5nL3BhcnNpbmcsXG4gICAgICogZXhwZWN0aW5nIGBjYWxsYmFjayhlcnJvciwgZGF0YSlgIHRvIGJlIGNhbGxlZCB3aXRoIGVpdGhlciBhbiBlcnJvciBvciBhXG4gICAgICogcGFyc2VkIEdlb0pTT04gb2JqZWN0LlxuICAgICAqXG4gICAgICogV2hlbiBgbG9hZERhdGFgIHJlcXVlc3RzIGNvbWUgaW4gZmFzdGVyIHRoYW4gdGhleSBjYW4gYmUgcHJvY2Vzc2VkLFxuICAgICAqIHRoZXkgYXJlIGNvYWxlc2NlZCBpbnRvIGEgc2luZ2xlIHJlcXVlc3QgdXNpbmcgdGhlIGxhdGVzdCBkYXRhLlxuICAgICAqIFNlZSB7QGxpbmsgR2VvSlNPTldvcmtlclNvdXJjZSNjb2FsZXNjZX1cbiAgICAgKlxuICAgICAqIEBwYXJhbSBwYXJhbXNcbiAgICAgKiBAcGFyYW0gY2FsbGJhY2tcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIGxvYWREYXRhKHBhcmFtczogTG9hZEdlb0pTT05QYXJhbWV0ZXJzLCBjYWxsYmFjazogQ2FsbGJhY2s8e1xuICAgICAgICByZXNvdXJjZVRpbWluZz86IHtbXzogc3RyaW5nXTogQXJyYXk8UGVyZm9ybWFuY2VSZXNvdXJjZVRpbWluZz59LFxuICAgICAgICBhYmFuZG9uZWQ/OiBib29sZWFuIH0+KSB7XG4gICAgICAgIGlmICh0aGlzLl9wZW5kaW5nQ2FsbGJhY2spIHtcbiAgICAgICAgICAgIC8vIFRlbGwgdGhlIGZvcmVncm91bmQgdGhlIHByZXZpb3VzIGNhbGwgaGFzIGJlZW4gYWJhbmRvbmVkXG4gICAgICAgICAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2sobnVsbCwge2FiYW5kb25lZDogdHJ1ZX0pO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3BlbmRpbmdDYWxsYmFjayA9IGNhbGxiYWNrO1xuICAgICAgICB0aGlzLl9wZW5kaW5nTG9hZERhdGFQYXJhbXMgPSBwYXJhbXM7XG5cbiAgICAgICAgaWYgKHRoaXMuX3N0YXRlICYmXG4gICAgICAgICAgICB0aGlzLl9zdGF0ZSAhPT0gJ0lkbGUnKSB7XG4gICAgICAgICAgICB0aGlzLl9zdGF0ZSA9ICdOZWVkc0xvYWREYXRhJztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX3N0YXRlID0gJ0NvYWxlc2NpbmcnO1xuICAgICAgICAgICAgdGhpcy5fbG9hZERhdGEoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEludGVybmFsIGltcGxlbWVudGF0aW9uOiBjYWxsZWQgZGlyZWN0bHkgYnkgYGxvYWREYXRhYFxuICAgICAqIG9yIGJ5IGBjb2FsZXNjZWAgdXNpbmcgc3RvcmVkIHBhcmFtZXRlcnMuXG4gICAgICovXG4gICAgX2xvYWREYXRhKCkge1xuICAgICAgICBpZiAoIXRoaXMuX3BlbmRpbmdDYWxsYmFjayB8fCAhdGhpcy5fcGVuZGluZ0xvYWREYXRhUGFyYW1zKSB7XG4gICAgICAgICAgICBhc3NlcnQoZmFsc2UpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGNhbGxiYWNrID0gdGhpcy5fcGVuZGluZ0NhbGxiYWNrO1xuICAgICAgICBjb25zdCBwYXJhbXMgPSB0aGlzLl9wZW5kaW5nTG9hZERhdGFQYXJhbXM7XG4gICAgICAgIGRlbGV0ZSB0aGlzLl9wZW5kaW5nQ2FsbGJhY2s7XG4gICAgICAgIGRlbGV0ZSB0aGlzLl9wZW5kaW5nTG9hZERhdGFQYXJhbXM7XG5cbiAgICAgICAgY29uc3QgcGVyZiA9IChwYXJhbXMgJiYgcGFyYW1zLnJlcXVlc3QgJiYgcGFyYW1zLnJlcXVlc3QuY29sbGVjdFJlc291cmNlVGltaW5nKSA/XG4gICAgICAgICAgICBuZXcgUmVxdWVzdFBlcmZvcm1hbmNlKHBhcmFtcy5yZXF1ZXN0KSA6IGZhbHNlO1xuXG4gICAgICAgIHRoaXMubG9hZEdlb0pTT04ocGFyYW1zLCAoZXJyOiA/RXJyb3IsIGRhdGE6ID9PYmplY3QpID0+IHtcbiAgICAgICAgICAgIGlmIChlcnIgfHwgIWRhdGEpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGRhdGEgIT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG5ldyBFcnJvcihgSW5wdXQgZGF0YSBnaXZlbiB0byAnJHtwYXJhbXMuc291cmNlfScgaXMgbm90IGEgdmFsaWQgR2VvSlNPTiBvYmplY3QuYCkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXdpbmQoZGF0YSwgdHJ1ZSk7XG5cbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBpZiAocGFyYW1zLmZpbHRlcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29tcGlsZWQgPSBjcmVhdGVFeHByZXNzaW9uKHBhcmFtcy5maWx0ZXIsIHt0eXBlOiAnYm9vbGVhbicsICdwcm9wZXJ0eS10eXBlJzogJ2RhdGEtZHJpdmVuJywgb3ZlcnJpZGFibGU6IGZhbHNlLCB0cmFuc2l0aW9uOiBmYWxzZX0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNvbXBpbGVkLnJlc3VsdCA9PT0gJ2Vycm9yJylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoY29tcGlsZWQudmFsdWUubWFwKGVyciA9PiBgJHtlcnIua2V5fTogJHtlcnIubWVzc2FnZX1gKS5qb2luKCcsICcpKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZmVhdHVyZXMgPSBkYXRhLmZlYXR1cmVzLmZpbHRlcihmZWF0dXJlID0+IGNvbXBpbGVkLnZhbHVlLmV2YWx1YXRlKHt6b29tOiAwfSwgZmVhdHVyZSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGF0YSA9IHt0eXBlOiAnRmVhdHVyZUNvbGxlY3Rpb24nLCBmZWF0dXJlc307XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9nZW9KU09OSW5kZXggPSBwYXJhbXMuY2x1c3RlciA/XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXcgU3VwZXJjbHVzdGVyKGdldFN1cGVyY2x1c3Rlck9wdGlvbnMocGFyYW1zKSkubG9hZChkYXRhLmZlYXR1cmVzKSA6XG4gICAgICAgICAgICAgICAgICAgICAgICBnZW9qc29udnQoZGF0YSwgcGFyYW1zLmdlb2pzb25WdE9wdGlvbnMpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvYWRlZCA9IHt9O1xuXG4gICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0ge307XG4gICAgICAgICAgICAgICAgaWYgKHBlcmYpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzb3VyY2VUaW1pbmdEYXRhID0gcGVyZi5maW5pc2goKTtcbiAgICAgICAgICAgICAgICAgICAgLy8gaXQncyBuZWNlc3NhcnkgdG8gZXZhbCB0aGUgcmVzdWx0IG9mIGdldEVudHJpZXNCeU5hbWUoKSBoZXJlIHZpYSBwYXJzZS9zdHJpbmdpZnlcbiAgICAgICAgICAgICAgICAgICAgLy8gbGF0ZSBldmFsdWF0aW9uIGluIHRoZSBtYWluIHRocmVhZCBjYXVzZXMgVHlwZUVycm9yOiBpbGxlZ2FsIGludm9jYXRpb25cbiAgICAgICAgICAgICAgICAgICAgaWYgKHJlc291cmNlVGltaW5nRGF0YSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnJlc291cmNlVGltaW5nID0ge307XG4gICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQucmVzb3VyY2VUaW1pbmdbcGFyYW1zLnNvdXJjZV0gPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHJlc291cmNlVGltaW5nRGF0YSkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHJlc3VsdCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFdoaWxlIHByb2Nlc3NpbmcgYGxvYWREYXRhYCwgd2UgY29hbGVzY2UgYWxsIGZ1cnRoZXJcbiAgICAgKiBgbG9hZERhdGFgIG1lc3NhZ2VzIGludG8gYSBzaW5nbGUgY2FsbCB0byBfbG9hZERhdGFcbiAgICAgKiB0aGF0IHdpbGwgaGFwcGVuIG9uY2Ugd2UndmUgZmluaXNoZWQgcHJvY2Vzc2luZyB0aGVcbiAgICAgKiBmaXJzdCBtZXNzYWdlLiB7QGxpbmsgR2VvSlNPTlNvdXJjZSNfdXBkYXRlV29ya2VyRGF0YX1cbiAgICAgKiBpcyByZXNwb25zaWJsZSBmb3Igc2VuZGluZyB1cyB0aGUgYGNvYWxlc2NlYCBtZXNzYWdlXG4gICAgICogYXQgdGhlIHRpbWUgaXQgcmVjZWl2ZXMgYSByZXNwb25zZSBmcm9tIGBsb2FkRGF0YWBcbiAgICAgKlxuICAgICAqICAgICAgICAgIFN0YXRlOiBJZGxlXG4gICAgICogICAgICAgICAg4oaRICAgICAgICAgIHxcbiAgICAgKiAgICAgJ2NvYWxlc2NlJyAgICdsb2FkRGF0YSdcbiAgICAgKiAgICAgICAgICB8ICAgICAodHJpZ2dlcnMgbG9hZClcbiAgICAgKiAgICAgICAgICB8ICAgICAgICAgIOKGk1xuICAgICAqICAgICAgICBTdGF0ZTogQ29hbGVzY2luZ1xuICAgICAqICAgICAgICAgIOKGkSAgICAgICAgICB8XG4gICAgICogICAodHJpZ2dlcnMgbG9hZCkgICB8XG4gICAgICogICAgICdjb2FsZXNjZScgICAnbG9hZERhdGEnXG4gICAgICogICAgICAgICAgfCAgICAgICAgICDihpNcbiAgICAgKiAgICAgICAgU3RhdGU6IE5lZWRzTG9hZERhdGFcbiAgICAgKi9cbiAgICBjb2FsZXNjZSgpIHtcbiAgICAgICAgaWYgKHRoaXMuX3N0YXRlID09PSAnQ29hbGVzY2luZycpIHtcbiAgICAgICAgICAgIHRoaXMuX3N0YXRlID0gJ0lkbGUnO1xuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX3N0YXRlID09PSAnTmVlZHNMb2FkRGF0YScpIHtcbiAgICAgICAgICAgIHRoaXMuX3N0YXRlID0gJ0NvYWxlc2NpbmcnO1xuICAgICAgICAgICAgdGhpcy5fbG9hZERhdGEoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICogSW1wbGVtZW50cyB7QGxpbmsgV29ya2VyU291cmNlI3JlbG9hZFRpbGV9LlxuICAgICpcbiAgICAqIElmIHRoZSB0aWxlIGlzIGxvYWRlZCwgdXNlcyB0aGUgaW1wbGVtZW50YXRpb24gaW4gVmVjdG9yVGlsZVdvcmtlclNvdXJjZS5cbiAgICAqIE90aGVyd2lzZSwgc3VjaCBhcyBhZnRlciBhIHNldERhdGEoKSBjYWxsLCB3ZSBsb2FkIHRoZSB0aWxlIGZyZXNoLlxuICAgICpcbiAgICAqIEBwYXJhbSBwYXJhbXNcbiAgICAqIEBwYXJhbSBwYXJhbXMudWlkIFRoZSBVSUQgZm9yIHRoaXMgdGlsZS5cbiAgICAqIEBwcml2YXRlXG4gICAgKi9cbiAgICByZWxvYWRUaWxlKHBhcmFtczogV29ya2VyVGlsZVBhcmFtZXRlcnMsIGNhbGxiYWNrOiBXb3JrZXJUaWxlQ2FsbGJhY2spIHtcbiAgICAgICAgY29uc3QgbG9hZGVkID0gdGhpcy5sb2FkZWQsXG4gICAgICAgICAgICB1aWQgPSBwYXJhbXMudWlkO1xuXG4gICAgICAgIGlmIChsb2FkZWQgJiYgbG9hZGVkW3VpZF0pIHtcbiAgICAgICAgICAgIHJldHVybiBzdXBlci5yZWxvYWRUaWxlKHBhcmFtcywgY2FsbGJhY2spO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMubG9hZFRpbGUocGFyYW1zLCBjYWxsYmFjayk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBGZXRjaCBhbmQgcGFyc2UgR2VvSlNPTiBhY2NvcmRpbmcgdG8gdGhlIGdpdmVuIHBhcmFtcy4gIENhbGxzIGBjYWxsYmFja2BcbiAgICAgKiB3aXRoIGAoZXJyLCBkYXRhKWAsIHdoZXJlIGBkYXRhYCBpcyBhIHBhcnNlZCBHZW9KU09OIG9iamVjdC5cbiAgICAgKlxuICAgICAqIEdlb0pTT04gaXMgbG9hZGVkIGFuZCBwYXJzZWQgZnJvbSBgcGFyYW1zLnVybGAgaWYgaXQgZXhpc3RzLCBvciBlbHNlXG4gICAgICogZXhwZWN0ZWQgYXMgYSBsaXRlcmFsIChzdHJpbmcgb3Igb2JqZWN0KSBgcGFyYW1zLmRhdGFgLlxuICAgICAqXG4gICAgICogQHBhcmFtIHBhcmFtc1xuICAgICAqIEBwYXJhbSBbcGFyYW1zLnVybF0gQSBVUkwgdG8gdGhlIHJlbW90ZSBHZW9KU09OIGRhdGEuXG4gICAgICogQHBhcmFtIFtwYXJhbXMuZGF0YV0gTGl0ZXJhbCBHZW9KU09OIGRhdGEuIE11c3QgYmUgcHJvdmlkZWQgaWYgYHBhcmFtcy51cmxgIGlzIG5vdC5cbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIGxvYWRHZW9KU09OKHBhcmFtczogTG9hZEdlb0pTT05QYXJhbWV0ZXJzLCBjYWxsYmFjazogUmVzcG9uc2VDYWxsYmFjazxPYmplY3Q+KSB7XG4gICAgICAgIC8vIEJlY2F1c2Ugb2Ygc2FtZSBvcmlnaW4gaXNzdWVzLCB1cmxzIG11c3QgZWl0aGVyIGluY2x1ZGUgYW4gZXhwbGljaXRcbiAgICAgICAgLy8gb3JpZ2luIG9yIGFic29sdXRlIHBhdGguXG4gICAgICAgIC8vIGllOiAvZm9vL2Jhci5qc29uIG9yIGh0dHA6Ly9leGFtcGxlLmNvbS9iYXIuanNvblxuICAgICAgICAvLyBidXQgbm90IC4uL2Zvby9iYXIuanNvblxuICAgICAgICBpZiAocGFyYW1zLnJlcXVlc3QpIHtcbiAgICAgICAgICAgIGdldEpTT04ocGFyYW1zLnJlcXVlc3QsIGNhbGxiYWNrKTtcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgcGFyYW1zLmRhdGEgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayhudWxsLCBKU09OLnBhcnNlKHBhcmFtcy5kYXRhKSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG5ldyBFcnJvcihgSW5wdXQgZGF0YSBnaXZlbiB0byAnJHtwYXJhbXMuc291cmNlfScgaXMgbm90IGEgdmFsaWQgR2VvSlNPTiBvYmplY3QuYCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG5ldyBFcnJvcihgSW5wdXQgZGF0YSBnaXZlbiB0byAnJHtwYXJhbXMuc291cmNlfScgaXMgbm90IGEgdmFsaWQgR2VvSlNPTiBvYmplY3QuYCkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmVtb3ZlU291cmNlKHBhcmFtczoge3NvdXJjZTogc3RyaW5nfSwgY2FsbGJhY2s6IENhbGxiYWNrPG1peGVkPikge1xuICAgICAgICBpZiAodGhpcy5fcGVuZGluZ0NhbGxiYWNrKSB7XG4gICAgICAgICAgICAvLyBEb24ndCBsZWFrIGNhbGxiYWNrc1xuICAgICAgICAgICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrKG51bGwsIHthYmFuZG9uZWQ6IHRydWV9KTtcbiAgICAgICAgfVxuICAgICAgICBjYWxsYmFjaygpO1xuICAgIH1cblxuICAgIGdldENsdXN0ZXJFeHBhbnNpb25ab29tKHBhcmFtczoge2NsdXN0ZXJJZDogbnVtYmVyfSwgY2FsbGJhY2s6IENhbGxiYWNrPG51bWJlcj4pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHRoaXMuX2dlb0pTT05JbmRleC5nZXRDbHVzdGVyRXhwYW5zaW9uWm9vbShwYXJhbXMuY2x1c3RlcklkKSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKGUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZ2V0Q2x1c3RlckNoaWxkcmVuKHBhcmFtczoge2NsdXN0ZXJJZDogbnVtYmVyfSwgY2FsbGJhY2s6IENhbGxiYWNrPEFycmF5PEdlb0pTT05GZWF0dXJlPj4pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHRoaXMuX2dlb0pTT05JbmRleC5nZXRDaGlsZHJlbihwYXJhbXMuY2x1c3RlcklkKSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKGUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZ2V0Q2x1c3RlckxlYXZlcyhwYXJhbXM6IHtjbHVzdGVySWQ6IG51bWJlciwgbGltaXQ6IG51bWJlciwgb2Zmc2V0OiBudW1iZXJ9LCBjYWxsYmFjazogQ2FsbGJhY2s8QXJyYXk8R2VvSlNPTkZlYXR1cmU+Pikge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgdGhpcy5fZ2VvSlNPTkluZGV4LmdldExlYXZlcyhwYXJhbXMuY2x1c3RlcklkLCBwYXJhbXMubGltaXQsIHBhcmFtcy5vZmZzZXQpKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgY2FsbGJhY2soZSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldFN1cGVyY2x1c3Rlck9wdGlvbnMoe3N1cGVyY2x1c3Rlck9wdGlvbnMsIGNsdXN0ZXJQcm9wZXJ0aWVzfSkge1xuICAgIGlmICghY2x1c3RlclByb3BlcnRpZXMgfHwgIXN1cGVyY2x1c3Rlck9wdGlvbnMpIHJldHVybiBzdXBlcmNsdXN0ZXJPcHRpb25zO1xuXG4gICAgY29uc3QgbWFwRXhwcmVzc2lvbnMgPSB7fTtcbiAgICBjb25zdCByZWR1Y2VFeHByZXNzaW9ucyA9IHt9O1xuICAgIGNvbnN0IGdsb2JhbHMgPSB7YWNjdW11bGF0ZWQ6IG51bGwsIHpvb206IDB9O1xuICAgIGNvbnN0IGZlYXR1cmUgPSB7cHJvcGVydGllczogbnVsbH07XG4gICAgY29uc3QgcHJvcGVydHlOYW1lcyA9IE9iamVjdC5rZXlzKGNsdXN0ZXJQcm9wZXJ0aWVzKTtcblxuICAgIGZvciAoY29uc3Qga2V5IG9mIHByb3BlcnR5TmFtZXMpIHtcbiAgICAgICAgY29uc3QgW29wZXJhdG9yLCBtYXBFeHByZXNzaW9uXSA9IGNsdXN0ZXJQcm9wZXJ0aWVzW2tleV07XG5cbiAgICAgICAgY29uc3QgbWFwRXhwcmVzc2lvblBhcnNlZCA9IGNyZWF0ZUV4cHJlc3Npb24obWFwRXhwcmVzc2lvbik7XG4gICAgICAgIGNvbnN0IHJlZHVjZUV4cHJlc3Npb25QYXJzZWQgPSBjcmVhdGVFeHByZXNzaW9uKFxuICAgICAgICAgICAgdHlwZW9mIG9wZXJhdG9yID09PSAnc3RyaW5nJyA/IFtvcGVyYXRvciwgWydhY2N1bXVsYXRlZCddLCBbJ2dldCcsIGtleV1dIDogb3BlcmF0b3IpO1xuXG4gICAgICAgIGFzc2VydChtYXBFeHByZXNzaW9uUGFyc2VkLnJlc3VsdCA9PT0gJ3N1Y2Nlc3MnKTtcbiAgICAgICAgYXNzZXJ0KHJlZHVjZUV4cHJlc3Npb25QYXJzZWQucmVzdWx0ID09PSAnc3VjY2VzcycpO1xuXG4gICAgICAgIG1hcEV4cHJlc3Npb25zW2tleV0gPSBtYXBFeHByZXNzaW9uUGFyc2VkLnZhbHVlO1xuICAgICAgICByZWR1Y2VFeHByZXNzaW9uc1trZXldID0gcmVkdWNlRXhwcmVzc2lvblBhcnNlZC52YWx1ZTtcbiAgICB9XG5cbiAgICBzdXBlcmNsdXN0ZXJPcHRpb25zLm1hcCA9IChwb2ludFByb3BlcnRpZXMpID0+IHtcbiAgICAgICAgZmVhdHVyZS5wcm9wZXJ0aWVzID0gcG9pbnRQcm9wZXJ0aWVzO1xuICAgICAgICBjb25zdCBwcm9wZXJ0aWVzID0ge307XG4gICAgICAgIGZvciAoY29uc3Qga2V5IG9mIHByb3BlcnR5TmFtZXMpIHtcbiAgICAgICAgICAgIHByb3BlcnRpZXNba2V5XSA9IG1hcEV4cHJlc3Npb25zW2tleV0uZXZhbHVhdGUoZ2xvYmFscywgZmVhdHVyZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb3BlcnRpZXM7XG4gICAgfTtcbiAgICBzdXBlcmNsdXN0ZXJPcHRpb25zLnJlZHVjZSA9IChhY2N1bXVsYXRlZCwgY2x1c3RlclByb3BlcnRpZXMpID0+IHtcbiAgICAgICAgZmVhdHVyZS5wcm9wZXJ0aWVzID0gY2x1c3RlclByb3BlcnRpZXM7XG4gICAgICAgIGZvciAoY29uc3Qga2V5IG9mIHByb3BlcnR5TmFtZXMpIHtcbiAgICAgICAgICAgIGdsb2JhbHMuYWNjdW11bGF0ZWQgPSBhY2N1bXVsYXRlZFtrZXldO1xuICAgICAgICAgICAgYWNjdW11bGF0ZWRba2V5XSA9IHJlZHVjZUV4cHJlc3Npb25zW2tleV0uZXZhbHVhdGUoZ2xvYmFscywgZmVhdHVyZSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgcmV0dXJuIHN1cGVyY2x1c3Rlck9wdGlvbnM7XG59XG5cbmV4cG9ydCBkZWZhdWx0IEdlb0pTT05Xb3JrZXJTb3VyY2U7XG4iLCIvLyBAZmxvd1xuXG5pbXBvcnQgQWN0b3IgZnJvbSAnLi4vdXRpbC9hY3Rvcic7XG5cbmltcG9ydCBTdHlsZUxheWVySW5kZXggZnJvbSAnLi4vc3R5bGUvc3R5bGVfbGF5ZXJfaW5kZXgnO1xuaW1wb3J0IFZlY3RvclRpbGVXb3JrZXJTb3VyY2UgZnJvbSAnLi92ZWN0b3JfdGlsZV93b3JrZXJfc291cmNlJztcbmltcG9ydCBSYXN0ZXJERU1UaWxlV29ya2VyU291cmNlIGZyb20gJy4vcmFzdGVyX2RlbV90aWxlX3dvcmtlcl9zb3VyY2UnO1xuaW1wb3J0IEdlb0pTT05Xb3JrZXJTb3VyY2UgZnJvbSAnLi9nZW9qc29uX3dvcmtlcl9zb3VyY2UnO1xuaW1wb3J0IGFzc2VydCBmcm9tICdhc3NlcnQnO1xuaW1wb3J0IHtwbHVnaW4gYXMgZ2xvYmFsUlRMVGV4dFBsdWdpbn0gZnJvbSAnLi9ydGxfdGV4dF9wbHVnaW4nO1xuaW1wb3J0IHtlbmZvcmNlQ2FjaGVTaXplTGltaXR9IGZyb20gJy4uL3V0aWwvdGlsZV9yZXF1ZXN0X2NhY2hlJztcblxuaW1wb3J0IHR5cGUge1xuICAgIFdvcmtlclNvdXJjZSxcbiAgICBXb3JrZXJUaWxlUGFyYW1ldGVycyxcbiAgICBXb3JrZXJERU1UaWxlUGFyYW1ldGVycyxcbiAgICBXb3JrZXJUaWxlQ2FsbGJhY2ssXG4gICAgV29ya2VyREVNVGlsZUNhbGxiYWNrLFxuICAgIFRpbGVQYXJhbWV0ZXJzXG59IGZyb20gJy4uL3NvdXJjZS93b3JrZXJfc291cmNlJztcblxuaW1wb3J0IHR5cGUge1dvcmtlckdsb2JhbFNjb3BlSW50ZXJmYWNlfSBmcm9tICcuLi91dGlsL3dlYl93b3JrZXInO1xuaW1wb3J0IHR5cGUge0NhbGxiYWNrfSBmcm9tICcuLi90eXBlcy9jYWxsYmFjayc7XG5pbXBvcnQgdHlwZSB7TGF5ZXJTcGVjaWZpY2F0aW9ufSBmcm9tICcuLi9zdHlsZS1zcGVjL3R5cGVzJztcbmltcG9ydCB0eXBlIHtQbHVnaW5TdGF0ZX0gZnJvbSAnLi9ydGxfdGV4dF9wbHVnaW4nO1xuXG4vKipcbiAqIEBwcml2YXRlXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFdvcmtlciB7XG4gICAgc2VsZjogV29ya2VyR2xvYmFsU2NvcGVJbnRlcmZhY2U7XG4gICAgYWN0b3I6IEFjdG9yO1xuICAgIGxheWVySW5kZXhlczoge1tfOiBzdHJpbmddOiBTdHlsZUxheWVySW5kZXggfTtcbiAgICBhdmFpbGFibGVJbWFnZXM6IHtbXzogc3RyaW5nXTogQXJyYXk8c3RyaW5nPiB9O1xuICAgIHdvcmtlclNvdXJjZVR5cGVzOiB7W186IHN0cmluZ106IENsYXNzPFdvcmtlclNvdXJjZT4gfTtcbiAgICB3b3JrZXJTb3VyY2VzOiB7W186IHN0cmluZ106IHtbXzogc3RyaW5nXToge1tfOiBzdHJpbmddOiBXb3JrZXJTb3VyY2UgfSB9IH07XG4gICAgZGVtV29ya2VyU291cmNlczoge1tfOiBzdHJpbmddOiB7W186IHN0cmluZ106IFJhc3RlckRFTVRpbGVXb3JrZXJTb3VyY2UgfSB9O1xuICAgIHJlZmVycmVyOiA/c3RyaW5nO1xuXG4gICAgY29uc3RydWN0b3Ioc2VsZjogV29ya2VyR2xvYmFsU2NvcGVJbnRlcmZhY2UpIHtcbiAgICAgICAgdGhpcy5zZWxmID0gc2VsZjtcbiAgICAgICAgdGhpcy5hY3RvciA9IG5ldyBBY3RvcihzZWxmLCB0aGlzKTtcblxuICAgICAgICB0aGlzLmxheWVySW5kZXhlcyA9IHt9O1xuICAgICAgICB0aGlzLmF2YWlsYWJsZUltYWdlcyA9IHt9O1xuXG4gICAgICAgIHRoaXMud29ya2VyU291cmNlVHlwZXMgPSB7XG4gICAgICAgICAgICB2ZWN0b3I6IFZlY3RvclRpbGVXb3JrZXJTb3VyY2UsXG4gICAgICAgICAgICBnZW9qc29uOiBHZW9KU09OV29ya2VyU291cmNlXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gW21hcElkXVtzb3VyY2VUeXBlXVtzb3VyY2VOYW1lXSA9PiB3b3JrZXIgc291cmNlIGluc3RhbmNlXG4gICAgICAgIHRoaXMud29ya2VyU291cmNlcyA9IHt9O1xuICAgICAgICB0aGlzLmRlbVdvcmtlclNvdXJjZXMgPSB7fTtcblxuICAgICAgICB0aGlzLnNlbGYucmVnaXN0ZXJXb3JrZXJTb3VyY2UgPSAobmFtZTogc3RyaW5nLCBXb3JrZXJTb3VyY2U6IENsYXNzPFdvcmtlclNvdXJjZT4pID0+IHtcbiAgICAgICAgICAgIGlmICh0aGlzLndvcmtlclNvdXJjZVR5cGVzW25hbWVdKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBXb3JrZXIgc291cmNlIHdpdGggbmFtZSBcIiR7bmFtZX1cIiBhbHJlYWR5IHJlZ2lzdGVyZWQuYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLndvcmtlclNvdXJjZVR5cGVzW25hbWVdID0gV29ya2VyU291cmNlO1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIFRoaXMgaXMgaW52b2tlZCBieSB0aGUgUlRMIHRleHQgcGx1Z2luIHdoZW4gdGhlIGRvd25sb2FkIHZpYSB0aGUgYGltcG9ydFNjcmlwdHNgIGNhbGwgaGFzIGZpbmlzaGVkLCBhbmQgdGhlIGNvZGUgaGFzIGJlZW4gcGFyc2VkLlxuICAgICAgICB0aGlzLnNlbGYucmVnaXN0ZXJSVExUZXh0UGx1Z2luID0gKHJ0bFRleHRQbHVnaW46IHthcHBseUFyYWJpY1NoYXBpbmc6IEZ1bmN0aW9uLCBwcm9jZXNzQmlkaXJlY3Rpb25hbFRleHQ6IEZ1bmN0aW9uLCBwcm9jZXNzU3R5bGVkQmlkaXJlY3Rpb25hbFRleHQ/OiBGdW5jdGlvbn0pID0+IHtcbiAgICAgICAgICAgIGlmIChnbG9iYWxSVExUZXh0UGx1Z2luLmlzUGFyc2VkKCkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1JUTCB0ZXh0IHBsdWdpbiBhbHJlYWR5IHJlZ2lzdGVyZWQuJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBnbG9iYWxSVExUZXh0UGx1Z2luWydhcHBseUFyYWJpY1NoYXBpbmcnXSA9IHJ0bFRleHRQbHVnaW4uYXBwbHlBcmFiaWNTaGFwaW5nO1xuICAgICAgICAgICAgZ2xvYmFsUlRMVGV4dFBsdWdpblsncHJvY2Vzc0JpZGlyZWN0aW9uYWxUZXh0J10gPSBydGxUZXh0UGx1Z2luLnByb2Nlc3NCaWRpcmVjdGlvbmFsVGV4dDtcbiAgICAgICAgICAgIGdsb2JhbFJUTFRleHRQbHVnaW5bJ3Byb2Nlc3NTdHlsZWRCaWRpcmVjdGlvbmFsVGV4dCddID0gcnRsVGV4dFBsdWdpbi5wcm9jZXNzU3R5bGVkQmlkaXJlY3Rpb25hbFRleHQ7XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgc2V0UmVmZXJyZXIobWFwSUQ6IHN0cmluZywgcmVmZXJyZXI6IHN0cmluZykge1xuICAgICAgICB0aGlzLnJlZmVycmVyID0gcmVmZXJyZXI7XG4gICAgfVxuXG4gICAgc2V0SW1hZ2VzKG1hcElkOiBzdHJpbmcsIGltYWdlczogQXJyYXk8c3RyaW5nPiwgY2FsbGJhY2s6IFdvcmtlclRpbGVDYWxsYmFjaykge1xuICAgICAgICB0aGlzLmF2YWlsYWJsZUltYWdlc1ttYXBJZF0gPSBpbWFnZXM7XG4gICAgICAgIGZvciAoY29uc3Qgd29ya2VyU291cmNlIGluIHRoaXMud29ya2VyU291cmNlc1ttYXBJZF0pIHtcbiAgICAgICAgICAgIGNvbnN0IHdzID0gdGhpcy53b3JrZXJTb3VyY2VzW21hcElkXVt3b3JrZXJTb3VyY2VdO1xuICAgICAgICAgICAgZm9yIChjb25zdCBzb3VyY2UgaW4gd3MpIHtcbiAgICAgICAgICAgICAgICB3c1tzb3VyY2VdLmF2YWlsYWJsZUltYWdlcyA9IGltYWdlcztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjYWxsYmFjaygpO1xuICAgIH1cblxuICAgIHNldExheWVycyhtYXBJZDogc3RyaW5nLCBsYXllcnM6IEFycmF5PExheWVyU3BlY2lmaWNhdGlvbj4sIGNhbGxiYWNrOiBXb3JrZXJUaWxlQ2FsbGJhY2spIHtcbiAgICAgICAgdGhpcy5nZXRMYXllckluZGV4KG1hcElkKS5yZXBsYWNlKGxheWVycyk7XG4gICAgICAgIGNhbGxiYWNrKCk7XG4gICAgfVxuXG4gICAgdXBkYXRlTGF5ZXJzKG1hcElkOiBzdHJpbmcsIHBhcmFtczoge2xheWVyczogQXJyYXk8TGF5ZXJTcGVjaWZpY2F0aW9uPiwgcmVtb3ZlZElkczogQXJyYXk8c3RyaW5nPn0sIGNhbGxiYWNrOiBXb3JrZXJUaWxlQ2FsbGJhY2spIHtcbiAgICAgICAgdGhpcy5nZXRMYXllckluZGV4KG1hcElkKS51cGRhdGUocGFyYW1zLmxheWVycywgcGFyYW1zLnJlbW92ZWRJZHMpO1xuICAgICAgICBjYWxsYmFjaygpO1xuICAgIH1cblxuICAgIGxvYWRUaWxlKG1hcElkOiBzdHJpbmcsIHBhcmFtczogV29ya2VyVGlsZVBhcmFtZXRlcnMgJiB7dHlwZTogc3RyaW5nfSwgY2FsbGJhY2s6IFdvcmtlclRpbGVDYWxsYmFjaykge1xuICAgICAgICBhc3NlcnQocGFyYW1zLnR5cGUpO1xuICAgICAgICB0aGlzLmdldFdvcmtlclNvdXJjZShtYXBJZCwgcGFyYW1zLnR5cGUsIHBhcmFtcy5zb3VyY2UpLmxvYWRUaWxlKHBhcmFtcywgY2FsbGJhY2spO1xuICAgIH1cblxuICAgIGxvYWRERU1UaWxlKG1hcElkOiBzdHJpbmcsIHBhcmFtczogV29ya2VyREVNVGlsZVBhcmFtZXRlcnMsIGNhbGxiYWNrOiBXb3JrZXJERU1UaWxlQ2FsbGJhY2spIHtcbiAgICAgICAgdGhpcy5nZXRERU1Xb3JrZXJTb3VyY2UobWFwSWQsIHBhcmFtcy5zb3VyY2UpLmxvYWRUaWxlKHBhcmFtcywgY2FsbGJhY2spO1xuICAgIH1cblxuICAgIHJlbG9hZFRpbGUobWFwSWQ6IHN0cmluZywgcGFyYW1zOiBXb3JrZXJUaWxlUGFyYW1ldGVycyAmIHt0eXBlOiBzdHJpbmd9LCBjYWxsYmFjazogV29ya2VyVGlsZUNhbGxiYWNrKSB7XG4gICAgICAgIGFzc2VydChwYXJhbXMudHlwZSk7XG4gICAgICAgIHRoaXMuZ2V0V29ya2VyU291cmNlKG1hcElkLCBwYXJhbXMudHlwZSwgcGFyYW1zLnNvdXJjZSkucmVsb2FkVGlsZShwYXJhbXMsIGNhbGxiYWNrKTtcbiAgICB9XG5cbiAgICBhYm9ydFRpbGUobWFwSWQ6IHN0cmluZywgcGFyYW1zOiBUaWxlUGFyYW1ldGVycyAmIHt0eXBlOiBzdHJpbmd9LCBjYWxsYmFjazogV29ya2VyVGlsZUNhbGxiYWNrKSB7XG4gICAgICAgIGFzc2VydChwYXJhbXMudHlwZSk7XG4gICAgICAgIHRoaXMuZ2V0V29ya2VyU291cmNlKG1hcElkLCBwYXJhbXMudHlwZSwgcGFyYW1zLnNvdXJjZSkuYWJvcnRUaWxlKHBhcmFtcywgY2FsbGJhY2spO1xuICAgIH1cblxuICAgIHJlbW92ZVRpbGUobWFwSWQ6IHN0cmluZywgcGFyYW1zOiBUaWxlUGFyYW1ldGVycyAmIHt0eXBlOiBzdHJpbmd9LCBjYWxsYmFjazogV29ya2VyVGlsZUNhbGxiYWNrKSB7XG4gICAgICAgIGFzc2VydChwYXJhbXMudHlwZSk7XG4gICAgICAgIHRoaXMuZ2V0V29ya2VyU291cmNlKG1hcElkLCBwYXJhbXMudHlwZSwgcGFyYW1zLnNvdXJjZSkucmVtb3ZlVGlsZShwYXJhbXMsIGNhbGxiYWNrKTtcbiAgICB9XG5cbiAgICByZW1vdmVERU1UaWxlKG1hcElkOiBzdHJpbmcsIHBhcmFtczogVGlsZVBhcmFtZXRlcnMpIHtcbiAgICAgICAgdGhpcy5nZXRERU1Xb3JrZXJTb3VyY2UobWFwSWQsIHBhcmFtcy5zb3VyY2UpLnJlbW92ZVRpbGUocGFyYW1zKTtcbiAgICB9XG5cbiAgICByZW1vdmVTb3VyY2UobWFwSWQ6IHN0cmluZywgcGFyYW1zOiB7c291cmNlOiBzdHJpbmd9ICYge3R5cGU6IHN0cmluZ30sIGNhbGxiYWNrOiBXb3JrZXJUaWxlQ2FsbGJhY2spIHtcbiAgICAgICAgYXNzZXJ0KHBhcmFtcy50eXBlKTtcbiAgICAgICAgYXNzZXJ0KHBhcmFtcy5zb3VyY2UpO1xuXG4gICAgICAgIGlmICghdGhpcy53b3JrZXJTb3VyY2VzW21hcElkXSB8fFxuICAgICAgICAgICAgIXRoaXMud29ya2VyU291cmNlc1ttYXBJZF1bcGFyYW1zLnR5cGVdIHx8XG4gICAgICAgICAgICAhdGhpcy53b3JrZXJTb3VyY2VzW21hcElkXVtwYXJhbXMudHlwZV1bcGFyYW1zLnNvdXJjZV0pIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHdvcmtlciA9IHRoaXMud29ya2VyU291cmNlc1ttYXBJZF1bcGFyYW1zLnR5cGVdW3BhcmFtcy5zb3VyY2VdO1xuICAgICAgICBkZWxldGUgdGhpcy53b3JrZXJTb3VyY2VzW21hcElkXVtwYXJhbXMudHlwZV1bcGFyYW1zLnNvdXJjZV07XG5cbiAgICAgICAgaWYgKHdvcmtlci5yZW1vdmVTb3VyY2UgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgd29ya2VyLnJlbW92ZVNvdXJjZShwYXJhbXMsIGNhbGxiYWNrKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBMb2FkIGEge0BsaW5rIFdvcmtlclNvdXJjZX0gc2NyaXB0IGF0IHBhcmFtcy51cmwuICBUaGUgc2NyaXB0IGlzIHJ1blxuICAgICAqICh1c2luZyBpbXBvcnRTY3JpcHRzKSB3aXRoIGByZWdpc3RlcldvcmtlclNvdXJjZWAgaW4gc2NvcGUsIHdoaWNoIGlzIGFcbiAgICAgKiBmdW5jdGlvbiB0YWtpbmcgYChuYW1lLCB3b3JrZXJTb3VyY2VPYmplY3QpYC5cbiAgICAgKiAgQHByaXZhdGVcbiAgICAgKi9cbiAgICBsb2FkV29ya2VyU291cmNlKG1hcDogc3RyaW5nLCBwYXJhbXM6IHsgdXJsOiBzdHJpbmcgfSwgY2FsbGJhY2s6IENhbGxiYWNrPHZvaWQ+KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICB0aGlzLnNlbGYuaW1wb3J0U2NyaXB0cyhwYXJhbXMudXJsKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKGUudG9TdHJpbmcoKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzeW5jUlRMUGx1Z2luU3RhdGUobWFwOiBzdHJpbmcsIHN0YXRlOiBQbHVnaW5TdGF0ZSwgY2FsbGJhY2s6IENhbGxiYWNrPGJvb2xlYW4+KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBnbG9iYWxSVExUZXh0UGx1Z2luLnNldFN0YXRlKHN0YXRlKTtcbiAgICAgICAgICAgIGNvbnN0IHBsdWdpblVSTCA9IGdsb2JhbFJUTFRleHRQbHVnaW4uZ2V0UGx1Z2luVVJMKCk7XG4gICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgZ2xvYmFsUlRMVGV4dFBsdWdpbi5pc0xvYWRlZCgpICYmXG4gICAgICAgICAgICAgICAgIWdsb2JhbFJUTFRleHRQbHVnaW4uaXNQYXJzZWQoKSAmJlxuICAgICAgICAgICAgICAgIHBsdWdpblVSTCAhPSBudWxsIC8vIE5vdCBwb3NzaWJsZSB3aGVuIGBpc0xvYWRlZGAgaXMgdHJ1ZSwgYnV0IGtlZXBzIGZsb3cgaGFwcHlcbiAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgIHRoaXMuc2VsZi5pbXBvcnRTY3JpcHRzKHBsdWdpblVSTCk7XG4gICAgICAgICAgICAgICAgY29uc3QgY29tcGxldGUgPSBnbG9iYWxSVExUZXh0UGx1Z2luLmlzUGFyc2VkKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgZXJyb3IgPSBjb21wbGV0ZSA/IHVuZGVmaW5lZCA6IG5ldyBFcnJvcihgUlRMIFRleHQgUGx1Z2luIGZhaWxlZCB0byBpbXBvcnQgc2NyaXB0cyBmcm9tICR7cGx1Z2luVVJMfWApO1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKGVycm9yLCBjb21wbGV0ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKGUudG9TdHJpbmcoKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXRBdmFpbGFibGVJbWFnZXMobWFwSWQ6IHN0cmluZykge1xuICAgICAgICBsZXQgYXZhaWxhYmxlSW1hZ2VzID0gdGhpcy5hdmFpbGFibGVJbWFnZXNbbWFwSWRdO1xuXG4gICAgICAgIGlmICghYXZhaWxhYmxlSW1hZ2VzKSB7XG4gICAgICAgICAgICBhdmFpbGFibGVJbWFnZXMgPSBbXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhdmFpbGFibGVJbWFnZXM7XG4gICAgfVxuXG4gICAgZ2V0TGF5ZXJJbmRleChtYXBJZDogc3RyaW5nKSB7XG4gICAgICAgIGxldCBsYXllckluZGV4ZXMgPSB0aGlzLmxheWVySW5kZXhlc1ttYXBJZF07XG4gICAgICAgIGlmICghbGF5ZXJJbmRleGVzKSB7XG4gICAgICAgICAgICBsYXllckluZGV4ZXMgPSB0aGlzLmxheWVySW5kZXhlc1ttYXBJZF0gPSBuZXcgU3R5bGVMYXllckluZGV4KCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGxheWVySW5kZXhlcztcbiAgICB9XG5cbiAgICBnZXRXb3JrZXJTb3VyY2UobWFwSWQ6IHN0cmluZywgdHlwZTogc3RyaW5nLCBzb3VyY2U6IHN0cmluZykge1xuICAgICAgICBpZiAoIXRoaXMud29ya2VyU291cmNlc1ttYXBJZF0pXG4gICAgICAgICAgICB0aGlzLndvcmtlclNvdXJjZXNbbWFwSWRdID0ge307XG4gICAgICAgIGlmICghdGhpcy53b3JrZXJTb3VyY2VzW21hcElkXVt0eXBlXSlcbiAgICAgICAgICAgIHRoaXMud29ya2VyU291cmNlc1ttYXBJZF1bdHlwZV0gPSB7fTtcblxuICAgICAgICBpZiAoIXRoaXMud29ya2VyU291cmNlc1ttYXBJZF1bdHlwZV1bc291cmNlXSkge1xuICAgICAgICAgICAgLy8gdXNlIGEgd3JhcHBlZCBhY3RvciBzbyB0aGF0IHdlIGNhbiBhdHRhY2ggYSB0YXJnZXQgbWFwSWQgcGFyYW1cbiAgICAgICAgICAgIC8vIHRvIGFueSBtZXNzYWdlcyBpbnZva2VkIGJ5IHRoZSBXb3JrZXJTb3VyY2VcbiAgICAgICAgICAgIGNvbnN0IGFjdG9yID0ge1xuICAgICAgICAgICAgICAgIHNlbmQ6ICh0eXBlLCBkYXRhLCBjYWxsYmFjaykgPT4ge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmFjdG9yLnNlbmQodHlwZSwgZGF0YSwgY2FsbGJhY2ssIG1hcElkKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgdGhpcy53b3JrZXJTb3VyY2VzW21hcElkXVt0eXBlXVtzb3VyY2VdID0gbmV3ICh0aGlzLndvcmtlclNvdXJjZVR5cGVzW3R5cGVdOiBhbnkpKChhY3RvcjogYW55KSwgdGhpcy5nZXRMYXllckluZGV4KG1hcElkKSwgdGhpcy5nZXRBdmFpbGFibGVJbWFnZXMobWFwSWQpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLndvcmtlclNvdXJjZXNbbWFwSWRdW3R5cGVdW3NvdXJjZV07XG4gICAgfVxuXG4gICAgZ2V0REVNV29ya2VyU291cmNlKG1hcElkOiBzdHJpbmcsIHNvdXJjZTogc3RyaW5nKSB7XG4gICAgICAgIGlmICghdGhpcy5kZW1Xb3JrZXJTb3VyY2VzW21hcElkXSlcbiAgICAgICAgICAgIHRoaXMuZGVtV29ya2VyU291cmNlc1ttYXBJZF0gPSB7fTtcblxuICAgICAgICBpZiAoIXRoaXMuZGVtV29ya2VyU291cmNlc1ttYXBJZF1bc291cmNlXSkge1xuICAgICAgICAgICAgdGhpcy5kZW1Xb3JrZXJTb3VyY2VzW21hcElkXVtzb3VyY2VdID0gbmV3IFJhc3RlckRFTVRpbGVXb3JrZXJTb3VyY2UoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmRlbVdvcmtlclNvdXJjZXNbbWFwSWRdW3NvdXJjZV07XG4gICAgfVxuXG4gICAgZW5mb3JjZUNhY2hlU2l6ZUxpbWl0KG1hcElkOiBzdHJpbmcsIGxpbWl0OiBudW1iZXIpIHtcbiAgICAgICAgZW5mb3JjZUNhY2hlU2l6ZUxpbWl0KGxpbWl0KTtcbiAgICB9XG59XG5cbi8qIGdsb2JhbCBzZWxmLCBXb3JrZXJHbG9iYWxTY29wZSAqL1xuaWYgKHR5cGVvZiBXb3JrZXJHbG9iYWxTY29wZSAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICB0eXBlb2Ygc2VsZiAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICBzZWxmIGluc3RhbmNlb2YgV29ya2VyR2xvYmFsU2NvcGUpIHtcbiAgICBzZWxmLndvcmtlciA9IG5ldyBXb3JrZXIoc2VsZik7XG59XG4iXSwibmFtZXMiOlsic3RyaW5naWZ5Iiwib2JqIiwiY29uc3QiLCJ0eXBlIiwidW5kZWZpbmVkIiwiSlNPTiIsIkFycmF5IiwiaXNBcnJheSIsImxldCIsInN0ciIsInZhbCIsImtleXMiLCJPYmplY3QiLCJzb3J0IiwiaSIsImxlbmd0aCIsImdldEtleSIsImxheWVyIiwia2V5IiwicmVmUHJvcGVydGllcyIsImsiLCJncm91cEJ5TGF5b3V0IiwibGF5ZXJzIiwiY2FjaGVkS2V5cyIsImdyb3VwcyIsImlkIiwiZ3JvdXAiLCJwdXNoIiwicmVzdWx0IiwiU3R5bGVMYXllckluZGV4IiwibGF5ZXJDb25maWdzIiwia2V5Q2FjaGUiLCJyZXBsYWNlIiwiX2xheWVyQ29uZmlncyIsIl9sYXllcnMiLCJ1cGRhdGUiLCJyZW1vdmVkSWRzIiwibGF5ZXJDb25maWciLCJjcmVhdGVTdHlsZUxheWVyIiwiX2ZlYXR1cmVGaWx0ZXIiLCJmZWF0dXJlRmlsdGVyIiwiZmlsdGVyIiwiZmFtaWxpZXNCeVNvdXJjZSIsInZhbHVlcyIsIm1hcCIsInRoaXMiLCJ2aXNpYmlsaXR5Iiwic291cmNlSWQiLCJzb3VyY2UiLCJzb3VyY2VHcm91cCIsInNvdXJjZUxheWVySWQiLCJzb3VyY2VMYXllciIsInNvdXJjZUxheWVyRmFtaWxpZXMiLCJwYWRkaW5nIiwiR2x5cGhBdGxhcyIsInN0YWNrcyIsInBvc2l0aW9ucyIsImJpbnMiLCJzdGFjayIsImdseXBocyIsInN0YWNrUG9zaXRpb25zIiwic3JjIiwiYml0bWFwIiwid2lkdGgiLCJoZWlnaHQiLCJiaW4iLCJ4IiwieSIsInciLCJoIiwicmVjdCIsIm1ldHJpY3MiLCJwb3RwYWNrIiwiaW1hZ2UiLCJBbHBoYUltYWdlIiwiY29weSIsInJlZ2lzdGVyIiwiV29ya2VyVGlsZSIsInBhcmFtcyIsInRpbGVJRCIsIk92ZXJzY2FsZWRUaWxlSUQiLCJvdmVyc2NhbGVkWiIsIndyYXAiLCJjYW5vbmljYWwiLCJ6IiwidWlkIiwiem9vbSIsInBpeGVsUmF0aW8iLCJ0aWxlU2l6ZSIsIm92ZXJzY2FsaW5nIiwib3ZlcnNjYWxlRmFjdG9yIiwic2hvd0NvbGxpc2lvbkJveGVzIiwiY29sbGVjdFJlc291cmNlVGltaW5nIiwicmV0dXJuRGVwZW5kZW5jaWVzIiwicHJvbW90ZUlkIiwicGFyc2UiLCJkYXRhIiwibGF5ZXJJbmRleCIsImF2YWlsYWJsZUltYWdlcyIsImFjdG9yIiwiY2FsbGJhY2siLCJzdGF0dXMiLCJjb2xsaXNpb25Cb3hBcnJheSIsIkNvbGxpc2lvbkJveEFycmF5Iiwic291cmNlTGF5ZXJDb2RlciIsIkRpY3Rpb25hcnlDb2RlciIsImZlYXR1cmVJbmRleCIsIkZlYXR1cmVJbmRleCIsImJ1Y2tldExheWVySURzIiwiYnVja2V0cyIsIm9wdGlvbnMiLCJpY29uRGVwZW5kZW5jaWVzIiwicGF0dGVybkRlcGVuZGVuY2llcyIsImdseXBoRGVwZW5kZW5jaWVzIiwibGF5ZXJGYW1pbGllcyIsInZlcnNpb24iLCJ3YXJuT25jZSIsInNvdXJjZUxheWVySW5kZXgiLCJlbmNvZGUiLCJmZWF0dXJlcyIsImluZGV4IiwiZmVhdHVyZSIsImdldElkIiwiZmFtaWx5IiwibWluem9vbSIsIk1hdGgiLCJmbG9vciIsIm1heHpvb20iLCJyZWNhbGN1bGF0ZUxheWVycyIsImJ1Y2tldCIsImNyZWF0ZUJ1Y2tldCIsInNvdXJjZUlEIiwicG9wdWxhdGUiLCJsIiwiZXJyb3IiLCJnbHlwaE1hcCIsImljb25NYXAiLCJwYXR0ZXJuTWFwIiwibWFwT2JqZWN0IiwiTnVtYmVyIiwic2VuZCIsImVyciIsIm1heWJlUHJlcGFyZSIsImNhbGwiLCJpY29ucyIsInBhdHRlcm5zIiwiZ2x5cGhBdGxhcyIsImltYWdlQXRsYXMiLCJJbWFnZUF0bGFzIiwiU3ltYm9sQnVja2V0IiwicGVyZm9ybVN5bWJvbExheW91dCIsImljb25Qb3NpdGlvbnMiLCJoYXNQYXR0ZXJuIiwiTGluZUJ1Y2tldCIsIkZpbGxCdWNrZXQiLCJGaWxsRXh0cnVzaW9uQnVja2V0IiwiYWRkRmVhdHVyZXMiLCJwYXR0ZXJuUG9zaXRpb25zIiwiYiIsImlzRW1wdHkiLCJnbHlwaEF0bGFzSW1hZ2UiLCJnbHlwaFBvc2l0aW9ucyIsInBhcmFtZXRlcnMiLCJFdmFsdWF0aW9uUGFyYW1ldGVycyIsInJlY2FsY3VsYXRlIiwibG9hZFZlY3RvclRpbGUiLCJyZXF1ZXN0IiwiZ2V0QXJyYXlCdWZmZXIiLCJjYWNoZUNvbnRyb2wiLCJleHBpcmVzIiwidmVjdG9yVGlsZSIsInZ0IiwiVmVjdG9yVGlsZSIsIlByb3RvYnVmIiwicmF3RGF0YSIsImNhbmNlbCIsIlZlY3RvclRpbGVXb3JrZXJTb3VyY2UiLCJsb2FkVmVjdG9yRGF0YSIsImxvYWRpbmciLCJsb2FkZWQiLCJsb2FkVGlsZSIsInBlcmYiLCJSZXF1ZXN0UGVyZm9ybWFuY2UiLCJ3b3JrZXJUaWxlIiwiYWJvcnQiLCJyZXNwb25zZSIsInJhd1RpbGVEYXRhIiwicmVzb3VyY2VUaW1pbmciLCJyZXNvdXJjZVRpbWluZ0RhdGEiLCJmaW5pc2giLCJleHRlbmQiLCJzbGljZSIsInJlbG9hZFRpbGUiLCJ2dFNvdXJjZSIsImRvbmUiLCJyZWxvYWRDYWxsYmFjayIsImFib3J0VGlsZSIsInJlbW92ZVRpbGUiLCJSYXN0ZXJERU1UaWxlV29ya2VyU291cmNlIiwiaW1hZ2VQaXhlbHMiLCJJbWFnZUJpdG1hcCIsInJhd0ltYWdlRGF0YSIsImdldEltYWdlRGF0YSIsImRlbSIsIkRFTURhdGEiLCJlbmNvZGluZyIsImltZ0JpdG1hcCIsIm9mZnNjcmVlbkNhbnZhcyIsIm9mZnNjcmVlbkNhbnZhc0NvbnRleHQiLCJPZmZzY3JlZW5DYW52YXMiLCJnZXRDb250ZXh0IiwiZHJhd0ltYWdlIiwiaW1nRGF0YSIsImNsZWFyUmVjdCIsIlJHQkFJbWFnZSIsIm1vZHVsZSIsInJld2luZCIsImdqIiwib3V0ZXIiLCJnZW9tZXRyaWVzIiwiZ2VvbWV0cnkiLCJyZXdpbmRSaW5ncyIsImNvb3JkaW5hdGVzIiwicmluZ3MiLCJyZXdpbmRSaW5nIiwicmluZyIsImRpciIsImFyZWEiLCJsZW4iLCJqIiwibSIsImFicyIsInJldmVyc2UiLCJ0b0dlb0pTT04iLCJtdnQiLCJWZWN0b3JUaWxlRmVhdHVyZSIsInByb3RvdHlwZSIsIkZlYXR1cmVXcmFwcGVyIiwiX2ZlYXR1cmUiLCJleHRlbnQiLCJFWFRFTlQiLCJwcm9wZXJ0aWVzIiwidGFncyIsImlzTmFOIiwicGFyc2VJbnQiLCJsb2FkR2VvbWV0cnkiLCJwb2ludCIsIlBvaW50IiwibmV3UmluZyIsIkdlb0pTT05XcmFwcGVyIiwibmFtZSIsIl9mZWF0dXJlcyIsInJlcXVpcmUiLCJyYXdHZW9tZXRyeSIsImJib3giLCJ4MSIsIkluZmluaXR5IiwieDIiLCJ5MSIsInkyIiwiY29vcmQiLCJtaW4iLCJtYXgiLCJmcm9tVmVjdG9yVGlsZUpzIiwiZnJvbUdlb2pzb25WdCIsInRpbGUiLCJvdXQiLCJQYmYiLCJ3cml0ZVRpbGUiLCJwYmYiLCJ3cml0ZU1lc3NhZ2UiLCJ3cml0ZUxheWVyIiwid3JpdGVWYXJpbnRGaWVsZCIsIndyaXRlU3RyaW5nRmllbGQiLCJjb250ZXh0Iiwia2V5Y2FjaGUiLCJ2YWx1ZWNhY2hlIiwid3JpdGVGZWF0dXJlIiwid3JpdGVWYWx1ZSIsIndyaXRlUHJvcGVydGllcyIsIndyaXRlR2VvbWV0cnkiLCJ2YWx1ZSIsImtleUluZGV4Iiwid3JpdGVWYXJpbnQiLCJ2YWx1ZUtleSIsInZhbHVlSW5kZXgiLCJjb21tYW5kIiwiY21kIiwiemlnemFnIiwibnVtIiwiciIsImNvdW50IiwibGluZUNvdW50IiwiZHgiLCJkeSIsIndyaXRlQm9vbGVhbkZpZWxkIiwid3JpdGVEb3VibGVGaWVsZCIsIndyaXRlU1ZhcmludEZpZWxkIiwic29ydEtEIiwiaWRzIiwiY29vcmRzIiwibm9kZVNpemUiLCJsZWZ0IiwicmlnaHQiLCJkZXB0aCIsInNlbGVjdCIsImluYyIsIm4iLCJsb2ciLCJzIiwiZXhwIiwic2QiLCJzcXJ0IiwibmV3TGVmdCIsIm5ld1JpZ2h0IiwidCIsInN3YXBJdGVtIiwic3dhcCIsImFyciIsInRtcCIsInJhbmdlIiwibWluWCIsIm1pblkiLCJtYXhYIiwibWF4WSIsImF4aXMiLCJwb3AiLCJuZXh0QXhpcyIsIndpdGhpbiIsInF4IiwicXkiLCJyMiIsInNxRGlzdCIsImF4IiwiYXkiLCJieCIsImJ5IiwiZGVmYXVsdEdldFgiLCJwIiwiZGVmYXVsdEdldFkiLCJLREJ1c2giLCJwb2ludHMiLCJnZXRYIiwiZ2V0WSIsIkFycmF5VHlwZSIsIkZsb2F0NjRBcnJheSIsIkluZGV4QXJyYXlUeXBlIiwiVWludDE2QXJyYXkiLCJVaW50MzJBcnJheSIsImRlZmF1bHRPcHRpb25zIiwibWluWm9vbSIsIm1heFpvb20iLCJtaW5Qb2ludHMiLCJyYWRpdXMiLCJnZW5lcmF0ZUlkIiwicmVkdWNlIiwicHJvcHMiLCJmcm91bmQiLCJGbG9hdDMyQXJyYXkiLCJTdXBlcmNsdXN0ZXIiLCJjcmVhdGUiLCJ0cmVlcyIsImxvYWQiLCJjb25zb2xlIiwidGltZSIsInRpbWVySWQiLCJjbHVzdGVycyIsImNyZWF0ZVBvaW50Q2x1c3RlciIsInRpbWVFbmQiLCJub3ciLCJEYXRlIiwiX2NsdXN0ZXIiLCJnZXRDbHVzdGVycyIsIm1pbkxuZyIsIm1pbkxhdCIsIm1heExuZyIsIm1heExhdCIsImVhc3Rlcm5IZW0iLCJ3ZXN0ZXJuSGVtIiwiY29uY2F0IiwidHJlZSIsIl9saW1pdFpvb20iLCJsbmdYIiwibGF0WSIsImMiLCJudW1Qb2ludHMiLCJnZXRDbHVzdGVySlNPTiIsImdldENoaWxkcmVuIiwiY2x1c3RlcklkIiwib3JpZ2luSWQiLCJfZ2V0T3JpZ2luSWQiLCJvcmlnaW5ab29tIiwiX2dldE9yaWdpblpvb20iLCJlcnJvck1zZyIsIkVycm9yIiwib3JpZ2luIiwicG93IiwiY2hpbGRyZW4iLCJwYXJlbnRJZCIsImdldExlYXZlcyIsImxpbWl0Iiwib2Zmc2V0IiwibGVhdmVzIiwiX2FwcGVuZExlYXZlcyIsImdldFRpbGUiLCJ6MiIsInRvcCIsImJvdHRvbSIsIl9hZGRUaWxlRmVhdHVyZXMiLCJnZXRDbHVzdGVyRXhwYW5zaW9uWm9vbSIsImV4cGFuc2lvblpvb20iLCJjbHVzdGVyX2lkIiwic2tpcHBlZCIsImNoaWxkIiwiY2x1c3RlciIsInBvaW50X2NvdW50IiwiaXNDbHVzdGVyIiwicHgiLCJweSIsImdldENsdXN0ZXJQcm9wZXJ0aWVzIiwiZiIsInJvdW5kIiwibmVpZ2hib3JJZHMiLCJudW1Qb2ludHNPcmlnaW4iLCJuZWlnaGJvcklkIiwid3giLCJ3eSIsImNsdXN0ZXJQcm9wZXJ0aWVzIiwiX21hcCIsIm51bVBvaW50czIiLCJjcmVhdGVDbHVzdGVyIiwiY2xvbmUiLCJvcmlnaW5hbCIsInhMbmciLCJ5TGF0IiwiYWJicmV2IiwicG9pbnRfY291bnRfYWJicmV2aWF0ZWQiLCJsbmciLCJsYXQiLCJzaW4iLCJQSSIsImF0YW4iLCJkZXN0Iiwic2ltcGxpZnkiLCJmaXJzdCIsImxhc3QiLCJzcVRvbGVyYW5jZSIsIm1heFNxRGlzdCIsIm1pZCIsIm1pblBvc1RvTWlkIiwiZCIsImdldFNxU2VnRGlzdCIsInBvc1RvTWlkIiwiY3JlYXRlRmVhdHVyZSIsImdlb20iLCJjYWxjQkJveCIsImNhbGNMaW5lQkJveCIsImNvbnZlcnQiLCJjb252ZXJ0RmVhdHVyZSIsImdlb2pzb24iLCJ0b2xlcmFuY2UiLCJjb252ZXJ0UG9pbnQiLCJjb252ZXJ0TGluZSIsImxpbmVNZXRyaWNzIiwiY29udmVydExpbmVzIiwicG9seWdvbiIsInByb2plY3RYIiwicHJvamVjdFkiLCJpc1BvbHlnb24iLCJ4MCIsInkwIiwic2l6ZSIsInN0YXJ0IiwiZW5kIiwiY2xpcCIsInNjYWxlIiwiazEiLCJrMiIsIm1pbkFsbCIsIm1heEFsbCIsImNsaXBwZWQiLCJuZXdHZW9tZXRyeSIsImNsaXBQb2ludHMiLCJjbGlwTGluZSIsImNsaXBMaW5lcyIsIm5ld0dlb20iLCJhIiwidHJhY2tNZXRyaWNzIiwibmV3U2xpY2UiLCJpbnRlcnNlY3QiLCJpbnRlcnNlY3RYIiwiaW50ZXJzZWN0WSIsInNlZ0xlbiIsImF6IiwiZXhpdGVkIiwiYWRkUG9pbnQiLCJsaW5lIiwiYnVmZmVyIiwibWVyZ2VkIiwic2hpZnRGZWF0dXJlQ29vcmRzIiwibmV3RmVhdHVyZXMiLCJzaGlmdENvb3JkcyIsIm5ld1BvbHlnb24iLCJuZXdQb2ludHMiLCJ0cmFuc2Zvcm1UaWxlIiwidHJhbnNmb3JtZWQiLCJ0eCIsInR5IiwidHJhbnNmb3JtUG9pbnQiLCJjcmVhdGVUaWxlIiwibnVtU2ltcGxpZmllZCIsIm51bUZlYXR1cmVzIiwiYWRkRmVhdHVyZSIsInNpbXBsaWZpZWQiLCJhZGRMaW5lIiwidGlsZUZlYXR1cmUiLCJpc091dGVyIiwiY2xvY2t3aXNlIiwiZ2VvanNvbnZ0IiwiR2VvSlNPTlZUIiwiZGVidWciLCJ0aWxlcyIsInRpbGVDb29yZHMiLCJpbmRleE1heFpvb20iLCJpbmRleE1heFBvaW50cyIsInN0YXRzIiwidG90YWwiLCJzcGxpdFRpbGUiLCJjeiIsImN4IiwiY3kiLCJ0b0lEIiwiazMiLCJrNCIsInRsIiwiYmwiLCJ0ciIsImJyIiwidHJhbnNmb3JtIiwiejAiLCJwYXJlbnQiLCJsb2FkR2VvSlNPTlRpbGUiLCJfZ2VvSlNPTkluZGV4IiwiZ2VvSlNPTlRpbGUiLCJnZW9qc29uV3JhcHBlciIsInZ0cGJmIiwiYnl0ZU9mZnNldCIsImJ5dGVMZW5ndGgiLCJVaW50OEFycmF5IiwiR2VvSlNPTldvcmtlclNvdXJjZSIsImxvYWRHZW9KU09OIiwic3VwZXIiLCJsb2FkRGF0YSIsIl9wZW5kaW5nQ2FsbGJhY2siLCJhYmFuZG9uZWQiLCJfcGVuZGluZ0xvYWREYXRhUGFyYW1zIiwiX3N0YXRlIiwiX2xvYWREYXRhIiwiY29tcGlsZWQiLCJjcmVhdGVFeHByZXNzaW9uIiwib3ZlcnJpZGFibGUiLCJ0cmFuc2l0aW9uIiwibWVzc2FnZSIsImpvaW4iLCJldmFsdWF0ZSIsImdldFN1cGVyY2x1c3Rlck9wdGlvbnMiLCJnZW9qc29uVnRPcHRpb25zIiwiY29hbGVzY2UiLCJnZXRKU09OIiwiZSIsInJlbW92ZVNvdXJjZSIsImdldENsdXN0ZXJDaGlsZHJlbiIsImdldENsdXN0ZXJMZWF2ZXMiLCJzdXBlcmNsdXN0ZXJPcHRpb25zIiwibWFwRXhwcmVzc2lvbnMiLCJyZWR1Y2VFeHByZXNzaW9ucyIsImdsb2JhbHMiLCJhY2N1bXVsYXRlZCIsInByb3BlcnR5TmFtZXMiLCJtYXBFeHByZXNzaW9uUGFyc2VkIiwibWFwRXhwcmVzc2lvbiIsInJlZHVjZUV4cHJlc3Npb25QYXJzZWQiLCJvcGVyYXRvciIsInBvaW50UHJvcGVydGllcyIsIldvcmtlciIsInNlbGYiLCJBY3RvciIsImxheWVySW5kZXhlcyIsIndvcmtlclNvdXJjZVR5cGVzIiwidmVjdG9yIiwid29ya2VyU291cmNlcyIsImRlbVdvcmtlclNvdXJjZXMiLCJyZWdpc3RlcldvcmtlclNvdXJjZSIsIldvcmtlclNvdXJjZSIsInJlZ2lzdGVyUlRMVGV4dFBsdWdpbiIsInJ0bFRleHRQbHVnaW4iLCJnbG9iYWxSVExUZXh0UGx1Z2luIiwiaXNQYXJzZWQiLCJhcHBseUFyYWJpY1NoYXBpbmciLCJwcm9jZXNzQmlkaXJlY3Rpb25hbFRleHQiLCJwcm9jZXNzU3R5bGVkQmlkaXJlY3Rpb25hbFRleHQiLCJzZXRSZWZlcnJlciIsIm1hcElEIiwicmVmZXJyZXIiLCJzZXRJbWFnZXMiLCJtYXBJZCIsImltYWdlcyIsIndvcmtlclNvdXJjZSIsIndzIiwic2V0TGF5ZXJzIiwiZ2V0TGF5ZXJJbmRleCIsInVwZGF0ZUxheWVycyIsImdldFdvcmtlclNvdXJjZSIsImxvYWRERU1UaWxlIiwiZ2V0REVNV29ya2VyU291cmNlIiwicmVtb3ZlREVNVGlsZSIsIndvcmtlciIsImxvYWRXb3JrZXJTb3VyY2UiLCJpbXBvcnRTY3JpcHRzIiwidXJsIiwidG9TdHJpbmciLCJzeW5jUlRMUGx1Z2luU3RhdGUiLCJzdGF0ZSIsInNldFN0YXRlIiwicGx1Z2luVVJMIiwiZ2V0UGx1Z2luVVJMIiwiaXNMb2FkZWQiLCJjb21wbGV0ZSIsImdldEF2YWlsYWJsZUltYWdlcyIsImVuZm9yY2VDYWNoZVNpemVMaW1pdCIsIldvcmtlckdsb2JhbFNjb3BlIl0sIm1hcHBpbmdzIjoiOztBQUdBLFNBQVNBLFNBQVQsQ0FBbUJDLEdBQW5CLEVBQXdCO0FBQUEsSUFDcEJDLElBQU1DLElBQUEsR0FBTyxPQUFPRixHQUFwQkMsQ0FEb0I7QUFBQSxJQUVwQixJQUFJQyxJQUFBLEtBQVMsUUFBVCxJQUFxQkEsSUFBQSxLQUFTLFNBQTlCLElBQTJDQSxJQUFBLEtBQVMsUUFBcEQsSUFBZ0VGLEdBQUEsS0FBUUcsU0FBeEUsSUFBcUZILEdBQUEsS0FBUSxJQUFqRztRQUNJLE9BQU9JLElBQUEsQ0FBS0wsU0FBTCxDQUFlQyxHQUFmLENBQVA7S0FIZ0I7QUFBQSxJQUtwQixJQUFJSyxLQUFBLENBQU1DLE9BQU4sQ0FBY04sR0FBZCxDQUFKLEVBQXdCO0FBQUEsUUFDcEJPLElBQUlDLEtBQUFBLEdBQU0sR0FBVkQsQ0FEb0I7QUFBQSxRQUVwQix5QkFBa0JQLHNCQUFsQixVQUFBLEVBQXVCO0FBQUEsWUFBbEJDLElBQU1RLEdBQUEsWUFBTlIsQ0FBa0I7QUFBQSxZQUNuQk8sS0FBQUEsSUFBVVQsU0FBQSxDQUFVVSxHQUFWLE9BQVZELENBRG1CO0FBQUEsU0FGSDtBQUFBLFFBS3BCLE9BQVVBLEtBQUFBLE1BQVYsQ0FMb0I7QUFB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
