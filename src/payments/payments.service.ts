import { Inject, Injectable, Logger } from '@nestjs/common';
import { envs, NATS_SERVICE } from 'src/config';
import Stripe from 'stripe';
import { PaymentSessionDto } from './dto/payment-session.dto';
import { Request, Response } from 'express';
import { TestingModule } from '@nestjs/testing';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class PaymentsService {

    private readonly stripe = new Stripe(
        envs.stripeSecret
    );
    private readonly logger = new Logger('PaymentService');

    constructor(
        @Inject(NATS_SERVICE) private readonly client: ClientProxy
    ){}

    async createPaymentSession(paymentSessionDto: PaymentSessionDto) {

        const { currency, items, orderId } = paymentSessionDto;

        const lineItems = items.map( item => {
            return {
                price_data: {
                    currency: currency,
                    product_data: {
                        name: item.name
                    },
                    unit_amount: Math.round( item.price * 100 ),
                },
                quantity: item.quantity
            }
        });

        const session = await this.stripe.checkout.sessions.create({
            payment_intent_data: {
                metadata: {
                    orderId
                }
            },
            line_items: lineItems,

            // line_items: [
            //     {
            //         price_data: {
            //             currency: 'usd',
            //             product_data: {
            //                 name: 'T-Shirt'
            //             },
            //             unit_amount: 2000 // 20 dolares / 100 = 20.00 // 15.0000
            //         },
            //         quantity: 2
            //     }
            // ],
            mode: 'payment',
            success_url: envs.stripeSuccessUrl,
            cancel_url: envs.stripeCancelUrl,
        });

        // return session;
        return {
            cancelUrl: session.cancel_url,
            successUrl: session.success_url,
            url: session.url,
        }
    }

    async stripeWebhook( req: Request, res: Response ){
        const sig = req.headers['stripe-signature'];
        // console.log("Pasa aqui");

        let event: Stripe.Event;
        // Testing
        // const endpointSecret = 'whsec_398459ca88378399bd711ec388405a52e3fde052c62544fda4fdffc62e366433';
        // Real
        const endpointSecret = envs.stripeEndpointSecret; //'whsec_OI8AjraMy5SxNynHyGgJIuMQC9JDKO0S';

        try{

            // console.log(JSON.stringify(req['rawBody']));
            // hay que activar el rawBody en main.ts y en el controlador
            event = this.stripe.webhooks.constructEvent(req['rawBody'], sig, endpointSecret);
            // console.log(event);

        }catch(err){
            // console.log(err);
            res.status(400).send(`Webhook Error: ${err.message}`);
            return;
        }

        switch(event.type){
            case 'charge.succeeded':
                const chargeSucceeded = event.data.object;
                const payload = {
                    stripePaymentId: chargeSucceeded.id,
                    orderId: chargeSucceeded.metadata.orderId,
                    receiptUrl: chargeSucceeded.receipt_url,
                }
                // this.logger.debug({payload});
                this.client.emit('payment.succeeded', payload);
            break;
            default:
                console.log(`Evento ${event.type} not handled`);
        }

        return res.status(200).json({ sig });
    }
}
