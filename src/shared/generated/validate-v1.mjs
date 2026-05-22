import func1 from "ajv/dist/runtime/ucs2length";
import { fastFormats } from "ajv-formats/dist/formats";
"use strict";
export const validate = validate20;
export default validate20;
const schema31 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://raw.githubusercontent.com/raegen/moxy/v1.1.0/schema/v1.json","title":"moxy Scenario","description":"A named bundle of moxy mock rules. The unit of sharing for moxy v1.1.","type":"object","required":["moxyFormatVersion","name","rules"],"additionalProperties":true,"properties":{"$schema":{"type":"string","description":"URL to this JSON Schema. Enables IDE autocomplete + CI linting."},"moxyFormatVersion":{"const":1,"description":"Format version of the .moxy.json file. Decoupled from the moxy extension version."},"name":{"type":"string","minLength":1,"description":"Human-readable scenario name. Shown in the moxy library and used to derive the suggested filename on export."},"description":{"type":"string","description":"Optional context for bug-report consumers (what broken state does this reproduce?)."},"createdAt":{"type":"string","format":"date-time","description":"ISO 8601 timestamp when the scenario was created or last serialized."},"createdWith":{"type":"object","description":"Metadata about the moxy build that produced this file. Informational only.","additionalProperties":true,"properties":{"extensionVersion":{"type":"string"},"userAgent":{"type":"string"}}},"rules":{"type":"array","minItems":1,"description":"Mock rules. Evaluated top-down against each request; first match wins.","items":{"$ref":"#/$defs/rule"}}},"$defs":{"rule":{"type":"object","required":["match","mutate"],"additionalProperties":true,"properties":{"id":{"type":"string","description":"Source ID. Regenerated at import time as hash(match + mutate) for stable cross-machine identity."},"enabled":{"type":"boolean","default":true},"match":{"$ref":"#/$defs/matcher"},"mutate":{"$ref":"#/$defs/mutate"},"behavior":{"type":"object","description":"Reserved for future per-rule stochastic fields (probability, jitter, repeat). v1.1 ignores."}}},"matcher":{"description":"Discriminated union by `type`. v1.1 supports only `url-glob`.","oneOf":[{"$ref":"#/$defs/urlGlobMatcher"}]},"urlGlobMatcher":{"type":"object","required":["type","pattern"],"additionalProperties":true,"properties":{"type":{"const":"url-glob"},"pattern":{"type":"string","minLength":1,"description":"URL pattern. Uses native URLPattern when available; falls back to a minimatch-style glob (`*` = any chars except `/`, `**` = any chars including `/`)."},"method":{"type":"string","description":"HTTP method. `*` or empty string matches any method.","default":"*"}}},"mutate":{"type":"object","additionalProperties":true,"description":"What to do when this rule matches. At least one of status / body / headers / latencyMs must be present.","anyOf":[{"required":["status"]},{"required":["body"]},{"required":["headers"]},{"required":["latencyMs"]}],"properties":{"status":{"type":"integer","minimum":100,"maximum":599,"description":"HTTP status to synthesize. If absent and body is absent, the real status is passed through with only the latency/headers overrides applied."},"statusText":{"type":"string"},"headers":{"type":"object","additionalProperties":{"type":"string"},"description":"Response headers. In body-replace mode these are the only headers sent; in passthrough mode they merge into the real response's headers (overriding matching keys)."},"body":{"$ref":"#/$defs/mutateBody"},"latencyMs":{"type":"number","minimum":0,"maximum":60000,"description":"Delay before delivering the mocked response. In passthrough mode (no body), latency is added on top of the real request time."}}},"mutateBody":{"description":"Discriminated union by `type`. v1.1 supports text / base64 / json.","oneOf":[{"type":"object","required":["type","data"],"additionalProperties":false,"properties":{"type":{"const":"text"},"data":{"type":"string","maxLength":5242880,"description":"Plaintext / JSON-string / any UTF-8 payload. Max 5 MB."}}},{"type":"object","required":["type","data"],"additionalProperties":false,"properties":{"type":{"const":"base64"},"data":{"type":"string","maxLength":5242880,"description":"Base64-encoded binary payload. Max 5 MB after encoding."}}},{"type":"object","required":["type","data"],"additionalProperties":false,"properties":{"type":{"const":"json"},"data":{"description":"Arbitrary JSON value. moxy JSON.stringifies it when constructing the synthesized Response."}}}]}}};

const formats0 = fastFormats["date-time"];
const schema32 = {"type":"object","required":["match","mutate"],"additionalProperties":true,"properties":{"id":{"type":"string","description":"Source ID. Regenerated at import time as hash(match + mutate) for stable cross-machine identity."},"enabled":{"type":"boolean","default":true},"match":{"$ref":"#/$defs/matcher"},"mutate":{"$ref":"#/$defs/mutate"},"behavior":{"type":"object","description":"Reserved for future per-rule stochastic fields (probability, jitter, repeat). v1.1 ignores."}}};
const schema33 = {"description":"Discriminated union by `type`. v1.1 supports only `url-glob`.","oneOf":[{"$ref":"#/$defs/urlGlobMatcher"}]};
const schema34 = {"type":"object","required":["type","pattern"],"additionalProperties":true,"properties":{"type":{"const":"url-glob"},"pattern":{"type":"string","minLength":1,"description":"URL pattern. Uses native URLPattern when available; falls back to a minimatch-style glob (`*` = any chars except `/`, `**` = any chars including `/`)."},"method":{"type":"string","description":"HTTP method. `*` or empty string matches any method.","default":"*"}}};

function validate22(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate22.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs0 = errors;
let valid0 = false;
let passing0 = null;
const _errs1 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.type === undefined){
const err0 = {instancePath,schemaPath:"#/$defs/urlGlobMatcher/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.pattern === undefined){
const err1 = {instancePath,schemaPath:"#/$defs/urlGlobMatcher/required",keyword:"required",params:{missingProperty: "pattern"},message:"must have required property '"+"pattern"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.type !== undefined){
if("url-glob" !== data.type){
const err2 = {instancePath:instancePath+"/type",schemaPath:"#/$defs/urlGlobMatcher/properties/type/const",keyword:"const",params:{allowedValue: "url-glob"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.pattern !== undefined){
let data1 = data.pattern;
if(typeof data1 === "string"){
if(func1(data1) < 1){
const err3 = {instancePath:instancePath+"/pattern",schemaPath:"#/$defs/urlGlobMatcher/properties/pattern/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
else {
const err4 = {instancePath:instancePath+"/pattern",schemaPath:"#/$defs/urlGlobMatcher/properties/pattern/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.method !== undefined){
if(typeof data.method !== "string"){
const err5 = {instancePath:instancePath+"/method",schemaPath:"#/$defs/urlGlobMatcher/properties/method/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/$defs/urlGlobMatcher/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
var _valid0 = _errs1 === errors;
if(_valid0){
valid0 = true;
passing0 = 0;
var props0 = true;
}
if(!valid0){
const err7 = {instancePath,schemaPath:"#/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
else {
errors = _errs0;
if(vErrors !== null){
if(_errs0){
vErrors.length = _errs0;
}
else {
vErrors = null;
}
}
}
validate22.errors = vErrors;
evaluated0.props = props0;
return errors === 0;
}
validate22.evaluated = {"dynamicProps":true,"dynamicItems":false};

const schema35 = {"type":"object","additionalProperties":true,"description":"What to do when this rule matches. At least one of status / body / headers / latencyMs must be present.","anyOf":[{"required":["status"]},{"required":["body"]},{"required":["headers"]},{"required":["latencyMs"]}],"properties":{"status":{"type":"integer","minimum":100,"maximum":599,"description":"HTTP status to synthesize. If absent and body is absent, the real status is passed through with only the latency/headers overrides applied."},"statusText":{"type":"string"},"headers":{"type":"object","additionalProperties":{"type":"string"},"description":"Response headers. In body-replace mode these are the only headers sent; in passthrough mode they merge into the real response's headers (overriding matching keys)."},"body":{"$ref":"#/$defs/mutateBody"},"latencyMs":{"type":"number","minimum":0,"maximum":60000,"description":"Delay before delivering the mocked response. In passthrough mode (no body), latency is added on top of the real request time."}}};
const schema36 = {"description":"Discriminated union by `type`. v1.1 supports text / base64 / json.","oneOf":[{"type":"object","required":["type","data"],"additionalProperties":false,"properties":{"type":{"const":"text"},"data":{"type":"string","maxLength":5242880,"description":"Plaintext / JSON-string / any UTF-8 payload. Max 5 MB."}}},{"type":"object","required":["type","data"],"additionalProperties":false,"properties":{"type":{"const":"base64"},"data":{"type":"string","maxLength":5242880,"description":"Base64-encoded binary payload. Max 5 MB after encoding."}}},{"type":"object","required":["type","data"],"additionalProperties":false,"properties":{"type":{"const":"json"},"data":{"description":"Arbitrary JSON value. moxy JSON.stringifies it when constructing the synthesized Response."}}}]};

function validate24(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate24.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs1 = errors;
let valid0 = false;
const _errs2 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.status === undefined){
const err0 = {instancePath,schemaPath:"#/anyOf/0/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
var _valid0 = _errs2 === errors;
valid0 = valid0 || _valid0;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.body === undefined){
const err1 = {instancePath,schemaPath:"#/anyOf/1/required",keyword:"required",params:{missingProperty: "body"},message:"must have required property '"+"body"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
var _valid0 = _errs3 === errors;
valid0 = valid0 || _valid0;
const _errs4 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.headers === undefined){
const err2 = {instancePath,schemaPath:"#/anyOf/2/required",keyword:"required",params:{missingProperty: "headers"},message:"must have required property '"+"headers"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
var _valid0 = _errs4 === errors;
valid0 = valid0 || _valid0;
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.latencyMs === undefined){
const err3 = {instancePath,schemaPath:"#/anyOf/3/required",keyword:"required",params:{missingProperty: "latencyMs"},message:"must have required property '"+"latencyMs"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
var _valid0 = _errs5 === errors;
valid0 = valid0 || _valid0;
if(!valid0){
const err4 = {instancePath,schemaPath:"#/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
else {
errors = _errs1;
if(vErrors !== null){
if(_errs1){
vErrors.length = _errs1;
}
else {
vErrors = null;
}
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.status !== undefined){
let data0 = data.status;
if(!((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0)))){
const err5 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(typeof data0 == "number"){
if(data0 > 599 || isNaN(data0)){
const err6 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/maximum",keyword:"maximum",params:{comparison: "<=", limit: 599},message:"must be <= 599"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data0 < 100 || isNaN(data0)){
const err7 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/minimum",keyword:"minimum",params:{comparison: ">=", limit: 100},message:"must be >= 100"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
if(data.statusText !== undefined){
if(typeof data.statusText !== "string"){
const err8 = {instancePath:instancePath+"/statusText",schemaPath:"#/properties/statusText/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.headers !== undefined){
let data2 = data.headers;
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
for(const key0 in data2){
if(typeof data2[key0] !== "string"){
const err9 = {instancePath:instancePath+"/headers/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/properties/headers/additionalProperties/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
else {
const err10 = {instancePath:instancePath+"/headers",schemaPath:"#/properties/headers/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.body !== undefined){
let data4 = data.body;
const _errs18 = errors;
let valid4 = false;
let passing0 = null;
const _errs19 = errors;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.type === undefined){
const err11 = {instancePath:instancePath+"/body",schemaPath:"#/$defs/mutateBody/oneOf/0/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data4.data === undefined){
const err12 = {instancePath:instancePath+"/body",schemaPath:"#/$defs/mutateBody/oneOf/0/required",keyword:"required",params:{missingProperty: "data"},message:"must have required property '"+"data"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
for(const key1 in data4){
if(!((key1 === "type") || (key1 === "data"))){
const err13 = {instancePath:instancePath+"/body",schemaPath:"#/$defs/mutateBody/oneOf/0/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data4.type !== undefined){
if("text" !== data4.type){
const err14 = {instancePath:instancePath+"/body/type",schemaPath:"#/$defs/mutateBody/oneOf/0/properties/type/const",keyword:"const",params:{allowedValue: "text"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data4.data !== undefined){
let data6 = data4.data;
if(typeof data6 === "string"){
if(func1(data6) > 5242880){
const err15 = {instancePath:instancePath+"/body/data",schemaPath:"#/$defs/mutateBody/oneOf/0/properties/data/maxLength",keyword:"maxLength",params:{limit: 5242880},message:"must NOT have more than 5242880 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
else {
const err16 = {instancePath:instancePath+"/body/data",schemaPath:"#/$defs/mutateBody/oneOf/0/properties/data/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
else {
const err17 = {instancePath:instancePath+"/body",schemaPath:"#/$defs/mutateBody/oneOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
var _valid1 = _errs19 === errors;
if(_valid1){
valid4 = true;
passing0 = 0;
var props0 = true;
}
const _errs25 = errors;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.type === undefined){
const err18 = {instancePath:instancePath+"/body",schemaPath:"#/$defs/mutateBody/oneOf/1/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(data4.data === undefined){
const err19 = {instancePath:instancePath+"/body",schemaPath:"#/$defs/mutateBody/oneOf/1/required",keyword:"required",params:{missingProperty: "data"},message:"must have required property '"+"data"+"'"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
for(const key2 in data4){
if(!((key2 === "type") || (key2 === "data"))){
const err20 = {instancePath:instancePath+"/body",schemaPath:"#/$defs/mutateBody/oneOf/1/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data4.type !== undefined){
if("base64" !== data4.type){
const err21 = {instancePath:instancePath+"/body/type",schemaPath:"#/$defs/mutateBody/oneOf/1/properties/type/const",keyword:"const",params:{allowedValue: "base64"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data4.data !== undefined){
let data8 = data4.data;
if(typeof data8 === "string"){
if(func1(data8) > 5242880){
const err22 = {instancePath:instancePath+"/body/data",schemaPath:"#/$defs/mutateBody/oneOf/1/properties/data/maxLength",keyword:"maxLength",params:{limit: 5242880},message:"must NOT have more than 5242880 characters"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
else {
const err23 = {instancePath:instancePath+"/body/data",schemaPath:"#/$defs/mutateBody/oneOf/1/properties/data/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
}
else {
const err24 = {instancePath:instancePath+"/body",schemaPath:"#/$defs/mutateBody/oneOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
var _valid1 = _errs25 === errors;
if(_valid1 && valid4){
valid4 = false;
passing0 = [passing0, 1];
}
else {
if(_valid1){
valid4 = true;
passing0 = 1;
if(props0 !== true){
props0 = true;
}
}
const _errs31 = errors;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.type === undefined){
const err25 = {instancePath:instancePath+"/body",schemaPath:"#/$defs/mutateBody/oneOf/2/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(data4.data === undefined){
const err26 = {instancePath:instancePath+"/body",schemaPath:"#/$defs/mutateBody/oneOf/2/required",keyword:"required",params:{missingProperty: "data"},message:"must have required property '"+"data"+"'"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
for(const key3 in data4){
if(!((key3 === "type") || (key3 === "data"))){
const err27 = {instancePath:instancePath+"/body",schemaPath:"#/$defs/mutateBody/oneOf/2/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key3},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data4.type !== undefined){
if("json" !== data4.type){
const err28 = {instancePath:instancePath+"/body/type",schemaPath:"#/$defs/mutateBody/oneOf/2/properties/type/const",keyword:"const",params:{allowedValue: "json"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
}
else {
const err29 = {instancePath:instancePath+"/body",schemaPath:"#/$defs/mutateBody/oneOf/2/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
var _valid1 = _errs31 === errors;
if(_valid1 && valid4){
valid4 = false;
passing0 = [passing0, 2];
}
else {
if(_valid1){
valid4 = true;
passing0 = 2;
if(props0 !== true){
props0 = true;
}
}
}
}
if(!valid4){
const err30 = {instancePath:instancePath+"/body",schemaPath:"#/$defs/mutateBody/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
else {
errors = _errs18;
if(vErrors !== null){
if(_errs18){
vErrors.length = _errs18;
}
else {
vErrors = null;
}
}
}
}
if(data.latencyMs !== undefined){
let data10 = data.latencyMs;
if(typeof data10 == "number"){
if(data10 > 60000 || isNaN(data10)){
const err31 = {instancePath:instancePath+"/latencyMs",schemaPath:"#/properties/latencyMs/maximum",keyword:"maximum",params:{comparison: "<=", limit: 60000},message:"must be <= 60000"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(data10 < 0 || isNaN(data10)){
const err32 = {instancePath:instancePath+"/latencyMs",schemaPath:"#/properties/latencyMs/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
else {
const err33 = {instancePath:instancePath+"/latencyMs",schemaPath:"#/properties/latencyMs/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
}
else {
const err34 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
validate24.errors = vErrors;
return errors === 0;
}
validate24.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate21(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate21.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.match === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "match"},message:"must have required property '"+"match"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.mutate === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mutate"},message:"must have required property '"+"mutate"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.id !== undefined){
if(typeof data.id !== "string"){
const err2 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.enabled !== undefined){
if(typeof data.enabled !== "boolean"){
const err3 = {instancePath:instancePath+"/enabled",schemaPath:"#/properties/enabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.match !== undefined){
if(!(validate22(data.match, {instancePath:instancePath+"/match",parentData:data,parentDataProperty:"match",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
errors = vErrors.length;
}
}
if(data.mutate !== undefined){
if(!(validate24(data.mutate, {instancePath:instancePath+"/mutate",parentData:data,parentDataProperty:"mutate",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate24.errors : vErrors.concat(validate24.errors);
errors = vErrors.length;
}
}
if(data.behavior !== undefined){
let data4 = data.behavior;
if(!(data4 && typeof data4 == "object" && !Array.isArray(data4))){
const err4 = {instancePath:instancePath+"/behavior",schemaPath:"#/properties/behavior/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate21.errors = vErrors;
return errors === 0;
}
validate21.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate20(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://raw.githubusercontent.com/raegen/moxy/v1.1.0/schema/v1.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate20.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.moxyFormatVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "moxyFormatVersion"},message:"must have required property '"+"moxyFormatVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.name === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.rules === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "rules"},message:"must have required property '"+"rules"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.$schema !== undefined){
if(typeof data.$schema !== "string"){
const err3 = {instancePath:instancePath+"/$schema",schemaPath:"#/properties/%24schema/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.moxyFormatVersion !== undefined){
if(1 !== data.moxyFormatVersion){
const err4 = {instancePath:instancePath+"/moxyFormatVersion",schemaPath:"#/properties/moxyFormatVersion/const",keyword:"const",params:{allowedValue: 1},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.name !== undefined){
let data2 = data.name;
if(typeof data2 === "string"){
if(func1(data2) < 1){
const err5 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.description !== undefined){
if(typeof data.description !== "string"){
const err7 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.createdAt !== undefined){
let data4 = data.createdAt;
if(typeof data4 === "string"){
if(!(formats0.validate.test(data4))){
const err8 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.createdWith !== undefined){
let data5 = data.createdWith;
if(data5 && typeof data5 == "object" && !Array.isArray(data5)){
if(data5.extensionVersion !== undefined){
if(typeof data5.extensionVersion !== "string"){
const err10 = {instancePath:instancePath+"/createdWith/extensionVersion",schemaPath:"#/properties/createdWith/properties/extensionVersion/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data5.userAgent !== undefined){
if(typeof data5.userAgent !== "string"){
const err11 = {instancePath:instancePath+"/createdWith/userAgent",schemaPath:"#/properties/createdWith/properties/userAgent/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
else {
const err12 = {instancePath:instancePath+"/createdWith",schemaPath:"#/properties/createdWith/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.rules !== undefined){
let data8 = data.rules;
if(Array.isArray(data8)){
if(data8.length < 1){
const err13 = {instancePath:instancePath+"/rules",schemaPath:"#/properties/rules/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
const len0 = data8.length;
for(let i0=0; i0<len0; i0++){
if(!(validate21(data8[i0], {instancePath:instancePath+"/rules/" + i0,parentData:data8,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
errors = vErrors.length;
}
}
}
else {
const err14 = {instancePath:instancePath+"/rules",schemaPath:"#/properties/rules/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
}
else {
const err15 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
validate20.errors = vErrors;
return errors === 0;
}
validate20.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};
