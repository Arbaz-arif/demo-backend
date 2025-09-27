const express = require("express");
const Product = require("../Models/product.model.js");
const router = express.Router();
const { getProducts, getProduct, createProduct, updateProduct, deleteproduct } = require("../Controller/produc-Controller.js");

router.get('/', getProducts);
router.get('/:id', getProduct);
router.post('/', createProduct);
router.put('/:id', updateProduct);
router.delete('/:id', deleteproduct);

module.exports = router;